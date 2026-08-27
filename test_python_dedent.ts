import { extractPythonSymbols } from './src/analyzer/pythonAnalyzer';

const pythonCode = `
class VoiceRequest:
    audio_data: str

    def __init__(self, data: str):
        self.audio_data = data

    def to_speech(self):
        print(self.audio_data)

def global_func():
    pass
`;

const symbols = extractPythonSymbols(pythonCode, 'backend/main.py');
console.log(JSON.stringify(symbols, null, 2));
