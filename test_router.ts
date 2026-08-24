import { QueryRouter } from './src/retrieval/queryRouter';

const router = new QueryRouter();
const query = "explain how the VoiceRequest and ChatRequest models work";
console.log(JSON.stringify(router.parseQuery(query), null, 2));
