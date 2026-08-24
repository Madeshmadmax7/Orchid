import { analyzeFile } from './src/analyzer/fileAnalyzer';
const src = `from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uvicorn

from assistant import assistant
from voice import voice_processor

class ChatRequest(BaseModel):
    message: str

class VoiceRequest(BaseModel):
    audio_data: Optional[str] = None

app = FastAPI()

@app.post("/chat")
async def handle_chat(request: ChatRequest) -> dict:
    return {"reply": "hello"}

def process_voice():
    pass`;

const meta = analyzeFile('main.py', src, 'python');
console.log('Symbols extracted:', meta.symbols.map(s => s.name));
console.log('Decorators:', meta.symbols.find(s => s.name === 'handle_chat')?.decorators);
console.log('Imports:', meta.imports.map(i => i.source));
