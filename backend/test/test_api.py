import io
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app import app

client = TestClient(app)


def test_challenge_request():
    response = client.post("/api/challenge/request")
    assert response.status_code == 200
    data = response.json()
    assert "session_id" in data
    assert "challenge_type" in data
    assert "prompt" in data
    assert "seed" in data


def test_verify_voice_missing_session():
    response = client.post(
        "/api/verify/voice",
        data={"session_id": "missing"},
        files={"audio": ("test.wav", io.BytesIO(b""), "audio/wav")},
    )
    assert response.status_code == 404


def test_verify_gesture_missing_session():
    response = client.post(
        "/api/verify/gesture",
        json={"session_id": "missing", "points": [[0, 0, 0], [1, 1, 1]]},
    )
    assert response.status_code == 404


def test_end_to_end_flow():
    response = client.post("/api/challenge/request")
    assert response.status_code == 200
    data = response.json()
    session_id = data["session_id"]

    # Use a generated waveform for voice test
    sample_rate = 16000
    duration = 0.5
    t = [i / sample_rate for i in range(int(sample_rate * duration))]
    wave = bytearray()
    for value in t:
        wave.extend(int((0.5 * (1 + value)) * 32767).to_bytes(2, "little", signed=True))

    response_voice = client.post(
        "/api/verify/voice",
        data={"session_id": session_id},
        files={"audio": ("test.wav", io.BytesIO(wave), "audio/wav")},
    )
    assert response_voice.status_code in (200, 400)

    response_gesture = client.post(
        "/api/verify/gesture",
        json={"session_id": session_id, "points": [[0, 0, 0], [0.5, 0.5, 1], [1, 1, 2]]},
    )
    assert response_gesture.status_code == 200
    gesture_data = response_gesture.json()
    assert "gesture_score" in gesture_data

    response_status = client.get(f"/api/auth/status/{session_id}")
    assert response_status.status_code == 200
    status_data = response_status.json()
    assert status_data["session_id"] == session_id
    assert "combined_score" in status_data
