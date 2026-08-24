import * as ts from 'typescript';
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
    audio_data: Optional[str] = None`;

const ast = ts.createSourceFile('test.py', src, ts.ScriptTarget.Latest, true);
console.log(ast.statements.filter(s => s.kind === ts.SyntaxKind.ClassDeclaration).map((s: any) => s.name?.text));
