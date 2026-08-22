export class ConceptExpander {
  private static dictionary: Record<string, string[]> = {
    validation: ['validate', 'validator', 'invalid', 'validationerror', 'check', 'verify', 'sanitize', 'throw', 'reject', 'error'],
    failure: ['fail', 'failed', 'error', 'exception', 'throw', 'catch', 'reject', 'rejected', 'invalid'],
    caller: ['called', 'calls', 'usage', 'uses', 'invokes', 'invoked', 'call'],
    payment: ['pay', 'transaction', 'charge', 'refund', 'fee'],
    auth: ['authentication', 'authorization', 'login', 'logout', 'session', 'token', 'jwt', 'credentials', 'password'],
    database: ['db', 'sql', 'query', 'repository', 'store', 'save', 'insert', 'update', 'delete', 'select', 'table', 'row'],
    api: ['endpoint', 'route', 'controller', 'request', 'response', 'http', 'get', 'post', 'put', 'patch', 'delete']
  };

  /**
   * Expands a list of keywords into a broader set of concepts.
   */
  static expand(keywords: string[]): string[] {
    const concepts = new Set<string>();

    for (const kw of keywords) {
      const lower = kw.toLowerCase();
      concepts.add(lower);

      // Add synonyms if it matches a key
      if (this.dictionary[lower]) {
        for (const synonym of this.dictionary[lower]) {
          concepts.add(synonym);
        }
      }

      // Check reverse mapping (if keyword is a synonym, add the root concept)
      for (const [key, synonyms] of Object.entries(this.dictionary)) {
        if (synonyms.includes(lower)) {
          concepts.add(key);
          // Optionally add all siblings:
          for (const sibling of synonyms) {
            concepts.add(sibling);
          }
        }
      }
    }

    return Array.from(concepts);
  }
}
