/**
       * Database connection module.
       */
      export const db = {
        /**
         * Database query can fail if connection drops.
         * Returns null if API endpoint drops connection.
         */
        async query(sql: string) {
          return null;
        }
      };