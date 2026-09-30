import { supabaseClient } from '@/app/lib/supabase';
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

import { vectorStore, sentenceVectorStore, childVectorStore, raptorVectorStore } from '@/app/lib/supabase';
import { buildRaptorTree } from '@/app/lib/raptor';
import { buildSentenceWindowDocuments } from '@/app/lib/sentence-window';
import { buildChildDocuments } from '@/app/lib/parent-document';
import { extractGraphData, insertGraphData } from '@/app/lib/graph-rag';

export async function GET(req: Request) {
    const userId = req.headers.get('User-Id');
    const { data, error } = await supabaseClient
        .storage
        .from('document_store')
        .list('', { search: userId || '' });

    if (error || !data.length || !data[0].name.includes(userId || '')) {
        return new Response(error?.message || 'Document search failed', { status: 400 });
    }

    const { data: fileData, error: fileError } = await supabaseClient
        .storage
        .from('document_store')
        .download(data[0].name);

    if (fileError) {
        return new Response(fileError?.message || 'Document fetch failed', { status: 400 });
    }

    return new Response(fileData);
}

export async function POST(req: Request) {
    const userId = req.headers.get('User-Id');
    if (!userId) return new Response('User ID is required', { status: 400 });

    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) return new Response('File is required', { status: 400 });

    const fileExtension = file?.name.split('.').pop();
    if (!fileExtension) return new Response('File extension could not be determined', { status: 400 });

    const { error } = await supabaseClient
        .storage
        .from('document_store')
        .upload(`${userId}.${fileExtension}`, file, { upsert: true });

    if (error) return new Response(error.message || 'Upload failed', { status: 400 });

    const pdfLoader = new PDFLoader(file, { splitPages: true, parsedItemSeparator: '' });
    const pdfDoc = await pdfLoader.load();

    const pageContent = pdfDoc.map(doc => doc.pageContent);
    const pageHeaders = pdfDoc.map(doc => ({
        documentName: file.name,
        pageNumber: doc?.metadata?.loc?.pageNumber,
        userId,
    }));

    const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 100,
        separators: ['\n\n', '\n', ' ', ''],
    });

    const docOutput = await splitter.createDocuments([...pageContent], pageHeaders);
    const sentenceDocOutput = pageContent.flatMap((text, i) =>
        buildSentenceWindowDocuments(text, pageHeaders[i])
    );
    const childDocOutput = await buildChildDocuments(docOutput);

    const { error: deleteError } = await supabaseClient.rpc('delete_documents_by_user', { userid: userId });
    if (deleteError) throw new Response('Error in deleting embeddings!', { status: 400 });

    const { error: deleteSentenceError } = await supabaseClient.rpc('delete_sentence_documents_by_user', { userid: userId });
    if (deleteSentenceError) throw new Response('Error in deleting sentence embeddings!', { status: 400 });

    const { error: deleteChildError } = await supabaseClient.rpc('delete_child_documents_by_user', { userid: userId });
    if (deleteChildError) throw new Response('Error in deleting child embeddings!', { status: 400 });

    const { error: deleteGraphError } = await supabaseClient.rpc('delete_graph_data_by_user', { userid: userId });
    if (deleteGraphError) throw new Response('Error in deleting graph data!', { status: 400 });

    const { error: deleteRaptorError } = await supabaseClient.rpc('delete_raptor_documents_by_user', { userid: userId });
    if (deleteRaptorError) throw new Response('Error in deleting RAPTOR summaries!', { status: 400 });

    const insertedDocumentIds = await vectorStore().addDocuments(docOutput);
    await sentenceVectorStore().addDocuments(sentenceDocOutput);
    await childVectorStore().addDocuments(childDocOutput);

    // Entity/relation extraction for the "graph" RAG mode (see lib/graph-rag.ts and
    // supabaseScripts.txt STEP 12) — one extra LLM call per parent chunk, the same kind of
    // ingestion-cost tradeoff sentence-window's/parent-document's extra embedding calls are.
    // Needs the parent chunks' actual `documents.id` values (only known after insertion above)
    // so graph_entity_mentions can reference the right rows.
    const chunksForGraph = docOutput.map((doc, i) => ({ id: Number(insertedDocumentIds[i]), text: doc.pageContent }));
    const graphPlan = await extractGraphData(chunksForGraph);
    await insertGraphData(graphPlan, userId);

    // RAPTOR summary tree (see lib/raptor.ts and supabaseScripts.txt STEP 13) — clusters the
    // parent chunks by embedding, LLM-summarizes each cluster, and recurses. Only the summary
    // nodes are stored; the leaves are the `documents` rows written above. The heaviest ingestion
    // cost of any mode (one extra embedding pass plus ~N/5 + N/25 + ... summarization LLM calls).
    const raptorTree = await buildRaptorTree(docOutput);
    if (raptorTree.docs.length > 0) {
        await raptorVectorStore().addVectors(raptorTree.vectors, raptorTree.docs);
    }

    return new Response('', { status: 201 });
}