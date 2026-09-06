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
];
