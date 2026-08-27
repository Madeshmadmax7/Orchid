
class VoiceRequest:
    # Represents a request for a voice interaction
    audio_data: str

    def __init__(self, data: str):
        self.audio_data = data

    def to_speech(self):
        print(self.audio_data)
