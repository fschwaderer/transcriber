import base64
import io
import json
import os
import sys

from faster_whisper import WhisperModel

sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


model_name = os.getenv("WHISPER_MODEL", "small")
device = os.getenv("WHISPER_DEVICE", "cpu")
compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
cpu_threads = int(os.getenv("WHISPER_CPU_THREADS", "0"))

model = WhisperModel(
    model_name,
    device=device,
    compute_type=compute_type,
    cpu_threads=cpu_threads,
)
emit({"event": "ready", "model": model_name, "device": device})

for line in sys.stdin:
    request_id = None
    try:
        request = json.loads(line)
        request_id = request["id"]
        audio = io.BytesIO(base64.b64decode(request["audio"], validate=True))
        segments, _info = model.transcribe(
            audio,
            language=request.get("language") or "pt",
            beam_size=5,
            vad_filter=False,
            condition_on_previous_text=False,
            initial_prompt=(
                "Mensagem de voz informal em português brasileiro enviada pelo "
                "WhatsApp. Transcreva literalmente, com ortografia natural."
            ),
        )
        text = " ".join(segment.text.strip() for segment in segments).strip()
        if not text:
            raise ValueError("O modelo local retornou uma transcrição vazia.")
        emit({"id": request_id, "text": text})
    except Exception as error:
        emit({
            "id": request_id,
            "error": f"Falha na transcrição local: {error}",
        })
