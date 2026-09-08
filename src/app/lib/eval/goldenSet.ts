// Plain data file — no LangChain imports, server/script-only (unlike modes.ts/pipeline-metadata.ts
// this never needs to reach a client component).

export interface GoldenQuestion {
    question: string;
    groundTruth?: string;
}

// This golden set assumes "Attention Is All You Need" (Vaswani et al., 2017) is the currently
// uploaded document for whichever userId the eval script is run against — the questions probe
// its actual content, not generic RAG-demo questions, so the faithfulness/relevancy scores mean
// something. Re-upload that PDF under the eval user id before running `npm run eval`.
export const EVAL_DOCUMENT = "Attention Is All You Need";

export const GOLDEN_SET: GoldenQuestion[] = [
    {
        question: "What is the Transformer model and how does it differ from previous sequence transduction models?",
        groundTruth: "The Transformer is a model architecture that relies entirely on attention mechanisms, dispensing with recurrence and convolutions entirely, unlike previous sequence transduction models based on RNNs or CNNs with an encoder-decoder attention mechanism.",
    },
    {
        question: "How does multi-head attention work in the Transformer?",
        groundTruth: "Multi-head attention linearly projects the queries, keys, and values h times with different learned projections, performs the attention function in parallel on each projected version, then concatenates and projects the results, allowing the model to jointly attend to information from different representation subspaces at different positions.",
    },
    {
        question: "What is positional encoding used for in the Transformer, and how is it computed?",
        groundTruth: "Since the Transformer has no recurrence or convolution, positional encodings are added to the input embeddings to inject information about the relative or absolute position of tokens in the sequence, computed using sine and cosine functions of different frequencies.",
    },
    {
        question: "What datasets and training setup were used to train the Transformer models described in the paper?",
        groundTruth: "The models were trained on the WMT 2014 English-German and English-French translation datasets, using the Adam optimizer with a specific learning rate schedule that increases linearly for warmup steps then decreases proportionally to the inverse square root of the step number.",
    },
    {
        question: "Why do the authors argue self-attention is preferable to recurrent or convolutional layers?",
        groundTruth: "Self-attention layers connect all positions with a constant number of sequentially executed operations, are computationally cheaper than recurrent layers when sequence length is smaller than representation dimensionality, and allow more of the network to be parallelized while also yielding shorter paths between long-range dependencies in the network.",
    },
    {
        question: "What is the encoder-decoder structure of the Transformer, and how many layers does each stack have?",
        groundTruth: "The Transformer has an encoder mapping an input sequence to a sequence of continuous representations and a decoder generating an output sequence one element at a time; both the encoder and decoder are composed of a stack of N=6 identical layers.",
    },
    {
        question: "What is scaled dot-product attention, and why is the scaling factor needed?",
        groundTruth: "Scaled dot-product attention computes the dot products of the query with all keys, divides each by the square root of the key dimension d_k, and applies a softmax to obtain weights on the values; the scaling counteracts dot products growing large in magnitude for large d_k, which would push the softmax into regions with extremely small gradients.",
    },
    {
        question: "What regularization techniques were used when training the Transformer?",
        groundTruth: "The paper uses residual dropout (applied to the output of each sub-layer before it is added to the sub-layer input and normalized, and to the sums of the embeddings and positional encodings) and label smoothing during training.",
    },
    {
        question: "How did the Transformer perform on English constituency parsing, and why is that result notable?",
        groundTruth: "The Transformer generalized well to English constituency parsing, performing surprisingly well and outperforming most previously reported models even with limited task-specific tuning, despite the output having strong structural constraints and being much longer than the input — notable because it shows the architecture generalizes beyond machine translation.",
    },
    {
        question: "What do the base and big Transformer model configurations differ in, according to the paper?",
        groundTruth: "The paper describes multiple model size variants (e.g. the base and big models) that differ in dimensions such as the number of layers, model dimension, number of attention heads, and feed-forward inner-layer size, with the bigger models generally achieving better BLEU scores at a higher training cost.",
    },
];
