export const TOOL_DECLARATIONS = [
  {
    name: "search_documents",
    description:
      "Search the stored housing documents for this renter's confirmed state, county, city, and issue. The server applies that scope. Do not pass a city or a category.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "A short question in the renter's words. Do not send the whole conversation." },
      },
      required: ["query"],
    },
  },
  {
    name: "get_document",
    description: "Read one legal chunk that search_documents already returned on this turn.",
    parameters: {
      type: "OBJECT",
      properties: {
        chunkId: { type: "STRING", description: "The chunk id from search_documents." },
      },
      required: ["chunkId"],
    },
  },
];
