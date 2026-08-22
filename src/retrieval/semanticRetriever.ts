import { RetrievalQuery, RetrievedContext } from '../types';

/**
 * Placeholder abstraction for a future Vector/Embeddings database.
 * Returns an empty array until an embeddings provider is implemented.
 */
export class SemanticRetriever {
  retrieve(query: RetrievalQuery): RetrievedContext[] {
    // Currently no semantic provider is configured (e.g. Pinecone/Chroma).
    // Safe fallback: return no contexts.
    return [];
  }
}
