import hashlib
import io
import random
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from datetime import datetime
import secrets

import librosa
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from speechbrain.inference.speaker import SpeakerRecognition
import json
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Depends, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, JSON, ForeignKey, BLOB
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from starlette.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# New imports for gesture recognition
from fastdtw import fastdtw
from scipy.spatial.distance import euclidean

# ==========================================
# 1. APP INITIALIZATION AND MIDDLEWARE
# ==========================================
app = FastAPI(
    title="Adaptive Multimodal Verification API",
    description=(
        "FastAPI service for voice + gesture verification with adaptive scoring. "
        "Exposes OpenAPI/Swagger docs at /docs and ReDoc at /redoc."
    ),
    version="0.1",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")

# ==========================================
# 2. ORIGINAL PYDANTIC MODELS & SESSION STATE
# ==========================================
class ChallengeResponse(BaseModel):
    session_id: str
    challenge_type: str
    prompt: str
    seed: int

class VoiceResponse(BaseModel):
    humanity_score: float
    noise_score: float
    challenge_type: str

class GestureResponse(BaseModel):
    gesture_score: float
    challenge_type: str

class AuthStatusResponse(BaseModel):
    session_id: str
    voice_score: float
    gesture_score: float
    noise_score: float
    voice_weight: float
    gesture_weight: float
    combined_score: float
    auth_status: str

class GestureSubmission(BaseModel):
    session_id: str = Field(..., description="The authentication session ID.")
    points: List[List[float]] = Field(
        ...,
        description="List of gesture points in the form [x, y, t, pressure] or [x, y, t]",
        min_items=2,
    )

class VerificationResponse(BaseModel):
    session_id: str
    status: str
    message: str
    score: Optional[float] = None
    completed_factors: List[str]
    next_factors: List[str]

class UserUpdate(BaseModel):
    required_factors: Dict[str, str] = Field(..., description="Authentication sequence, e.g., {'1': 'voice', '2': 'gesture'}")

class GestureEnrollPayload(BaseModel):
    username: str
    points: List[List[float]] = Field(
        ...,
        min_items=2
    )

class UserCreate(BaseModel):
    username: str

class HapticEnrollPayload(BaseModel):
    username: str
    secret: List[str] = Field(
        ...,
        description="Secuencia secreta de patrones vibrotáctiles, p. ej. ['largo','corto','doble','corto']",
        min_length=3,
        max_length=6,
    )

class HapticChallengeResponse(BaseModel):
    session_id: str
    symbols: List[str] = Field(..., description="Alfabeto de patrones disponibles.")
    rounds: List[List[str]] = Field(
        ...,
        description="Una permutación por ronda: el orden en que el cliente debe reproducir los patrones.",
    )

class HapticSubmission(BaseModel):
    session_id: str
    selections: List[int] = Field(
        ...,
        description="Índice de la ranura elegida en cada ronda, en el mismo orden que las rondas.",
        min_length=1,
    )

class UserSummary(BaseModel):
    id: int
    username: str
    required_factors: Dict[str, str] = Field(..., description="Authentication sequence, e.g., {'1': 'voice', '2': 'gesture'}")
    enrolled_factors: List[str] = Field(..., description="Modalities the user actually has a biometric template for.")


@dataclass
class SessionState:
    session_id: str
    challenge_type: str
    seed: int
    prompt: str
    template: List[List[float]]
    voice_score: Optional[float] = None
    gesture_score: Optional[float] = None
    noise_score: Optional[float] = None
    created_at: float = field(default_factory=time.time)

class GesturePayload(BaseModel):
    session_id: str = Field(..., description="Session ID returned by /api/challenge/request")
    points: List[List[float]] = Field(
        ...,
        description="List of gesture points in the form [x, y, t, pressure] or [x, y, t]",
        min_items=2,
    )

session_store: Dict[str, SessionState] = {}

# ==========================================
# 3. DATABASE CONFIGURATION (SQLite)
# ==========================================
SQLALCHEMY_DATABASE_URL = "sqlite:///./inclusive_auth.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# ==========================================
# 4. DATABASE MODELS (Tables)
# ==========================================
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    required_factors = Column(JSON, nullable=False, default=lambda: {"1": "voice"})

class BiometricProfile(Base):
    __tablename__ = "biometric_profiles"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    voice_embedding = Column(JSON, nullable=True)
    gesture_embedding = Column(JSON, nullable=True)
    gesture_points = Column(JSON, nullable=True) # For visualization
    voice_audio = Column(BLOB, nullable=True)
    # El factor háptico es conocimiento, no biometría: se guarda derivado con sal, nunca
    # en claro y nunca como embedding. Un secreto es revocable; una voz no.
    haptic_hash = Column(String, nullable=True)
    haptic_salt = Column(String, nullable=True)
    haptic_length = Column(Integer, nullable=True)
    # Alfabeto vigente al momento de enrolar. Si el alfabeto del sistema cambia, un secreto
    # viejo deja de poder reproducirse y fallaría siempre, sin que nada explique por qué.
    haptic_alphabet = Column(JSON, nullable=True)

class AuthLog(Base):
    __tablename__ = "auth_logs"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    timestamp = Column(DateTime, default=datetime.utcnow)
    modality = Column(String)
    similarity_score = Column(Float)
    decision = Column(String)

class AuthSession(Base):
    __tablename__ = "auth_sessions"
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    status = Column(String, default="pending") # pending, completed, failed, expired
    expires_at = Column(DateTime)
    completed_factors = Column(JSON, default=[])
    # Permutaciones emitidas para el desafío háptico en curso. Se guardan del lado del
    # servidor porque son la clave para traducir las ranuras elegidas de vuelta a símbolos.
    haptic_challenge = Column(JSON, nullable=True)

Base.metadata.create_all(bind=engine)


def _ensure_columns():
    """
    Agrega las columnas nuevas a bases ya existentes.

    `create_all` sólo crea tablas que faltan: nunca altera una tabla que ya está. Sin esto,
    una base creada antes del factor háptico seguiría sin esas columnas y toda consulta
    fallaría. Es un reemplazo mínimo de una herramienta de migraciones, suficiente para
    una PoC de una sola instancia.
    """
    from sqlalchemy import text

    pending = {
        "biometric_profiles": {
            "haptic_hash": "TEXT",
            "haptic_salt": "TEXT",
            "haptic_length": "INTEGER",
            "haptic_alphabet": "JSON",
        },
        "auth_sessions": {
            "haptic_challenge": "JSON",
        },
    }

    with engine.begin() as connection:
        for table, columns in pending.items():
            existing = {row[1] for row in connection.execute(text(f"PRAGMA table_info({table})"))}
            for name, sql_type in columns.items():
                if name not in existing:
                    connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {sql_type}"))


_ensure_columns()

# ==========================================
# 5. DATABASE SESSION DEPENDENCY
# ==========================================
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ==========================================
# 6. ORIGINAL CHALLENGE/VERIFICATION ENDPOINTS
# ==========================================

def _build_gesture_template(seed: int) -> List[List[float]]:
    random.seed(seed)
    pattern = random.choice(["zigzag", "spiral", "checkmark"])
    if pattern == "zigzag":
        return [[0.1, 0.1], [0.4, 0.9], [0.6, 0.1], [0.9, 0.9]]
    if pattern == "spiral":
        return [[0.5 + 0.3 * np.cos(t), 0.5 + 0.3 * np.sin(t)] for t in np.linspace(0, 4.5, 12)]
    return [[0.1, 0.5], [0.4, 0.8], [0.9, 0.2]]

@app.post("/api/challenge/request", response_model=ChallengeResponse, summary="Create verification challenge", tags=["challenge"])
async def request_challenge():
    session_id = uuid.uuid4().hex
    seed = random.SystemRandom().randint(0, 2**31 - 1)
    challenge_type = random.choice(["voice_phrase", "gesture_pattern"])
    if challenge_type == "voice_phrase":
        prompt = random.choice(["Repite la frase 'abre la puerta' con tu voz.", "Di en voz alta: 'autenticación adaptativa'."])
        template = []
    else:
        prompt = "Dibuja un patrón táctil similar a una Z en la pantalla."
        template = _build_gesture_template(seed)
    session_store[session_id] = SessionState(session_id=session_id, challenge_type=challenge_type, seed=seed, prompt=prompt, template=template)
    return {"session_id": session_id, "challenge_type": challenge_type, "prompt": prompt, "seed": seed}

@app.post("/api/verify/voice", response_model=VoiceResponse, summary="Verify user's voice sample", tags=["verify", "voice"])
async def verify_voice(session_id: str = Form(...), audio: UploadFile = File(...)):
    state = session_store.get(session_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Session not found")
    audio_bytes = await audio.read()
    try:
        waveform, sr = librosa.load(io.BytesIO(audio_bytes), sr=16000, mono=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unable to read audio: {exc}")
    rms = np.mean(librosa.feature.rms(y=waveform))
    spectral_flatness = np.mean(librosa.feature.spectral_flatness(y=waveform))
    embedding = torch.from_numpy(np.mean(librosa.feature.mfcc(y=waveform, sr=sr, n_mfcc=13), axis=1)).float()
    score = 0.7 * float(torch.sigmoid(torch.tensor(np.log1p(rms * 1000.0)))) + 0.3 * float(torch.sigmoid(torch.mean(embedding / 100.0)))
    score = float(np.clip(score * (1.0 - 0.35 * float(np.clip(spectral_flatness, 0.0, 1.0))), 0.0, 1.0))
    state.voice_score = round(score, 3)
    state.noise_score = round(float(np.clip(spectral_flatness, 0.0, 1.0)), 3)
    return {"humanity_score": state.voice_score, "noise_score": state.noise_score, "challenge_type": state.challenge_type}

def _normalize_path(points: np.ndarray, target_len: int = 64) -> np.ndarray:
    distances = np.cumsum(np.linalg.norm(np.diff(points, axis=0), axis=1))
    distances = np.concatenate([[0.0], distances])
    target_distances = np.linspace(0.0, distances[-1], target_len)
    return np.stack([np.interp(target_distances, distances, points[:, i]) for i in range(points.shape[1])], axis=1)

@app.post("/api/verify/gesture-challenge", response_model=GestureResponse, summary="[Legacy] Verify user's gesture input for a challenge", tags=["challenge", "verify", "gesture"])
async def verify_gesture_challenge(payload: GesturePayload):
    state = session_store.get(payload.session_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Session not found")
    raw_points = np.array(payload.points, dtype=float)
    observed = _normalize_path(raw_points[:, :2])
    if not state.template:
        state.template = _build_gesture_template(state.seed)
    template = np.array(state.template, dtype=float)
    expected = _normalize_path(template)
    distance = np.mean(np.linalg.norm(observed - expected, axis=1))
    score = float(np.clip(1.0 - distance * 2.0, 0.0, 1.0))
    state.gesture_score = round(score, 3)
    return {"gesture_score": state.gesture_score, "challenge_type": state.challenge_type}

@app.get("/api/auth/status/{session_id}", response_model=AuthStatusResponse, summary="Get consolidated authentication status", tags=["auth"])
async def auth_status(session_id: str):
    state = session_store.get(session_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Session not found")
    voice = state.voice_score or 0.0
    gesture = state.gesture_score or 0.0
    noise = state.noise_score or 0.0
    voice_weight = 0.4 if noise >= 0.4 else 0.6
    gesture_weight = 1.0 - voice_weight
    combined_score = float(np.clip(voice * voice_weight + gesture * gesture_weight, 0.0, 1.0))
    auth_status = "authorized" if combined_score >= 0.65 else "denied"
    return {"session_id": session_id, "voice_score": voice, "gesture_score": gesture, "noise_score": noise, "voice_weight": round(voice_weight, 2), "gesture_weight": round(gesture_weight, 2), "combined_score": round(combined_score, 3), "auth_status": auth_status}

# ==========================================
# 7. AI/BIOMETRIC ENGINES (PyTorch & DTW)
# ==========================================

# Instantiate the model globally to avoid reloading on every request.
# This will download the model from HuggingFace on the first run.
speaker_model = SpeakerRecognition.from_hparams(
    source="speechbrain/spkrec-ecapa-voxceleb", 
    savedir="pretrained_models/spkrec-ecapa-voxceleb"
)

def extract_voice_embedding(audio_file: bytes) -> list:
    """
    Extracts a voice embedding using a pre-trained SpeechBrain model (ECAPA-TDNN).
    This is a state-of-the-art method for speaker recognition.
    """
    try:
        # Load audio data from bytes, ensure consistent sample rate
        waveform, sr = librosa.load(io.BytesIO(audio_file), sr=16000, mono=True)

        # Advanced silence removal: split by non-silent parts and concatenate them.
        # This removes silences from the middle of the utterance.
        non_silent_intervals = librosa.effects.split(waveform, top_db=25)
        if len(non_silent_intervals) == 0:
            raise ValueError("No se detectó voz en el audio.")
        
        waveform_cleaned = np.concatenate([waveform[start:end] for start, end in non_silent_intervals])

        # Check for minimum duration of 5 seconds (5 * 16000 = 80000 samples)
        if len(waveform_cleaned) < 80000:
            raise ValueError(f"La señal de audio debe tener al menos 5 segundos de voz activa. Duración detectada: {len(waveform_cleaned)/sr:.2f}s")

        # The model expects a torch tensor
        waveform_tensor = torch.from_numpy(waveform_cleaned).float()

        # Get the embedding (the model expects a batch, so we add a dimension)
        embedding = speaker_model.encode_batch(waveform_tensor.unsqueeze(0))
        
        # The model returns a 3D tensor [batch, 1, embedding_dim], we squeeze it to get a 1D vector
        return embedding.squeeze().tolist()
    except ValueError as e:
        # Catch specific value errors (like too short audio) and return a clear message
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        # Catch all other processing errors
        raise HTTPException(status_code=400, detail=f"No se pudo procesar el archivo de audio con SpeechBrain: {e}")
    

def compare_embeddings(emb1: list, emb2: list) -> float:
    """
    Compares two embeddings using cosine similarity.
    Returns a score between 0 and 1.
    """
    tensor1 = torch.tensor(emb1)
    tensor2 = torch.tensor(emb2)
    # Ensure tensors are 2D for cosine_similarity [batch_size, embedding_dim]
    if tensor1.dim() == 1:
        tensor1 = tensor1.unsqueeze(0)
    if tensor2.dim() == 1:
        tensor2 = tensor2.unsqueeze(0)
    similarity = F.cosine_similarity(tensor1, tensor2)
    # Ensure score is non-negative
    return max(0.0, similarity.item())

GESTURE_ACCEPTANCE_THRESHOLD = 0.80 # Score, not distance. Adjusted for cosine similarity.

# ==========================================
# 7.2 HAPTIC KNOWLEDGE FACTOR
# ==========================================
#
# Voz y gesto son ambos "algo que sos", y ambos viajan como una muestra que el servidor no
# puede distinguir de una grabación: un gesto idéntico puntúa 1.0 y se acepta. Este factor
# ataca esa clase de problema desde otro lado.
#
# Es un secreto de conocimiento verificado por desafío-respuesta. En cada ronda el servidor
# emite una permutación nueva del alfabeto de patrones; el cliente los reproduce en ese
# orden y el usuario toca durante el que corresponde al siguiente símbolo de su secreto.
# La respuesta viaja como índices de ranura, así que una respuesta capturada no sirve en la
# sesión siguiente: la permutación ya cambió. Eso es lo que la voz y el gesto no tienen.
#
# Además no se ve ni se oye: sólo vibra el teléfono en la mano. Vence al shoulder surfing
# y también a la escucha, que es la objeción práctica de la verificación por voz en público.
#
# Los símbolos son CANTIDADES DE PULSOS, no formas de onda. Una primera versión usaba
# patrones tipo "corto / largo / doble" y resultó inservible: distinguir formas exige del
# motor de vibración una fidelidad que la mayoría de los teléfonos no tiene, y del usuario
# una discriminación fina sin ninguna referencia contra la cual calibrar. Contar pulsos
# separados, en cambio, funciona en cualquier hardware y no hay nada que aprender.

HAPTIC_SYMBOLS = ["1", "2", "3"]

# Iteraciones de derivación. Alto a propósito: el secreto tiene poca entropía, así que el
# costo de cada intento es la defensa principal si la base se filtra.
HAPTIC_KDF_ITERATIONS = 200_000


def _hash_haptic_secret(secret: List[str], salt: str) -> str:
    material = "|".join(secret).encode("utf-8")
    return hashlib.pbkdf2_hmac(
        "sha256", material, bytes.fromhex(salt), HAPTIC_KDF_ITERATIONS
    ).hex()


def _validate_haptic_secret(secret: List[str]) -> None:
    invalid = [s for s in secret if s not in HAPTIC_SYMBOLS]
    if invalid:
        raise HTTPException(
            status_code=400,
            detail=f"Símbolos hápticos inválidos: {invalid}. Deben ser {HAPTIC_SYMBOLS}.",
        )


def _build_haptic_challenge(rounds: int) -> List[List[str]]:
    """Una permutación independiente por ronda, con aleatoriedad criptográfica."""
    rng = random.SystemRandom()
    challenge = []
    for _ in range(rounds):
        permutation = HAPTIC_SYMBOLS.copy()
        rng.shuffle(permutation)
        challenge.append(permutation)
    return challenge

# --- New Gesture Processing and LSTM Simulation ---

class SimulatedGestureLSTM(nn.Module):
    """
    Simulates an LSTM-based model for gesture embedding.
    In a real-world scenario, this would be a trained PyTorch nn.Module.
    Here, we simulate it by extracting statistical features that an LSTM might learn
    (mean, std of kinematic features) and passing them through a simple network.
    """
    def __init__(self, input_dim=3, embedding_dim=128):
        super().__init__()
        self.input_dim = input_dim
        self.embedding_dim = embedding_dim

    def forward(self, sequence_features: torch.Tensor) -> torch.Tensor:
        """
        Simulates encoding a sequence of kinematic features into a fixed-size embedding.
        This version divides the gesture into segments and computes stats for each,
        preserving partial sequential information to better distinguish different shapes.
        Global statistics (mean, std) were found to be insufficient as they lose
        all path information, leading to false positives (e.g., 'U' vs 'N').
        """
        if sequence_features.dim() == 1:
            sequence_features = sequence_features.unsqueeze(0)
        
        # A gesture needs enough points to be meaningfully segmented.
        # We use 4 segments, so we need at least 4 feature points (5 gesture points).
        if sequence_features.shape[0] < 4:
            # For very short gestures, fall back to global stats as it's not segmentable.
            if sequence_features.shape[0] > 0:
                mean = torch.mean(sequence_features, dim=0)
                std = torch.std(sequence_features, dim=0)
                # Ensure no NaNs if there's only one feature point.
                stats_vector = torch.cat((torch.nan_to_num(mean, nan=0.0), torch.nan_to_num(std, nan=0.0)))
                embedding = torch.zeros(self.embedding_dim)
                embedding[:len(stats_vector)] = stats_vector
                return F.normalize(embedding, p=2, dim=0)
            else:
                return torch.zeros(self.embedding_dim)

        num_segments = 4
        # Split the sequence of features (deltas) into segments.
        segments = torch.chunk(sequence_features, chunks=num_segments, dim=0)

        segment_stats_list = []
        for segment in segments:
            if segment.shape[0] == 0:
                # This can happen if the number of points is small. Append zero vectors.
                mean = torch.zeros(self.input_dim)
                std = torch.zeros(self.input_dim)
            else:
                mean = torch.mean(segment, dim=0)
                # If a segment has only one point, std is undefined (NaN). Set to zero.
                if segment.shape[0] == 1:
                    std = torch.zeros(self.input_dim)
                else:
                    std = torch.std(segment, dim=0)
            
            segment_stats_list.append(mean)
            segment_stats_list.append(std)

        # Concatenate all stats into a single feature vector.
        stats_vector = torch.cat(segment_stats_list)
        
        # Create the final embedding.
        embedding = torch.zeros(self.embedding_dim)
        
        # Place the stats at the beginning of the embedding vector.
        num_features_to_copy = min(len(stats_vector), self.embedding_dim)
        embedding[:num_features_to_copy] = stats_vector[:num_features_to_copy]
        
        # Normalize to a unit vector, which is standard for cosine similarity.
        return F.normalize(embedding, p=2, dim=0)

# Instantiate the simulated model globally.
gesture_model_sim = SimulatedGestureLSTM()

def _preprocess_gesture(points: List[List[float]]) -> torch.Tensor:
    """
    Normalizes a raw gesture path for position and scale, and extracts kinematic features.
    This makes the gesture independent of where on the screen it was drawn and its size.
    
    Returns a tensor of features [dx, dy, dt] for each segment.
    """
    if len(points) < 5: # A gesture should have a minimum number of points to be meaningful.
        raise HTTPException(status_code=400, detail="El gesto es demasiado corto, se necesitan al menos 5 puntos.")

    points_np = np.array(points, dtype=np.float32)
    
    # Use only x, y, t.
    if points_np.shape[1] > 3:
        points_np = points_np[:, :3]

    # Ensure time is monotonically increasing and starts from 0.
    times = points_np[:, 2]
    if np.any(np.diff(times) < 0):
        raise HTTPException(status_code=400, detail="Los timestamps del gesto deben ser monotónicos.")
    points_np[:, 2] = times - times[0]

    coords = points_np[:, :2]

    # 1. Position Independence (Translation): Move the centroid to the origin (0,0).
    centroid = np.mean(coords, axis=0)
    coords_translated = coords - centroid

    # 2. Scale Independence (Normalization): Scale to fit within a [-1, 1] box.
    max_abs_val = np.max(np.abs(coords_translated))
    if max_abs_val < 1e-6: # Avoid division by zero for a gesture that is just a tap.
        raise HTTPException(status_code=400, detail="El gesto no tiene movimiento (es un punto).")
    coords_scaled = coords_translated / max_abs_val

    # 3. Kinematic Feature Extraction: Calculate delta_x, delta_y, delta_t for each segment.
    dx = np.diff(coords_scaled[:, 0])
    dy = np.diff(coords_scaled[:, 1])
    dt = np.diff(points_np[:, 2]) / 1000.0 # Convert ms to seconds for a more standard scale.

    # Replace any dt=0 with a small epsilon to avoid numerical instability.
    dt[dt < 1e-6] = 1e-6

    # The features for our LSTM are the deltas, which represent the gesture's dynamics.
    features = np.stack([dx, dy, dt], axis=1)
    
    return torch.from_numpy(features).float()

def _get_normalized_gesture_points(points: List[List[float]]) -> List[List[float]]:
    """
    Performs position and scale normalization on gesture points for visualization.
    This is a subset of the logic in _preprocess_gesture, focused only on the coordinates.
    """
    if len(points) < 2:
        return []

    coords = np.array(points, dtype=np.float32)[:, :2]

    # 1. Position Independence (Translation): Move the centroid to the origin (0,0).
    centroid = np.mean(coords, axis=0)
    coords_translated = coords - centroid

    # 2. Scale Independence (Normalization): Scale to fit within a [-1, 1] box.
    # This is slightly different from the main preprocessing to be better for visualization.
    # We scale so the largest deviation from the center becomes 1.
    max_abs_val = np.max(np.abs(coords_translated))
    if max_abs_val < 1e-6: # Avoid division by zero for a single point.
        # A single point should be drawn in the center of the canvas.
        return [[0.5, 0.5]]
    
    coords_scaled = coords_translated / max_abs_val # Range is [-1, 1]
    
    # Shift and scale from [-1, 1] to [0, 1] to fit the canvas coordinate system.
    coords_final = (coords_scaled + 1.0) / 2.0
    return coords_final.tolist()

def extract_gesture_embedding(points: List[List[float]]) -> List[float]:
    """
    Processes raw gesture points and extracts a fixed-size embedding using the simulated LSTM.
    """
    try:
        features = _preprocess_gesture(points)
        # The model is not in training, so we use torch.no_grad() for efficiency.
        with torch.no_grad():
            embedding = gesture_model_sim(features)
        return embedding.tolist()
    except HTTPException as e:
        # Re-raise HTTP exceptions from preprocessing to give clear client feedback.
        raise e
    except Exception as e:
        # Catch other unexpected errors during embedding extraction.
        raise HTTPException(status_code=500, detail=f"Error al extraer el embedding del gesto: {e}")

# ==========================================
# 7.5 USER MANAGEMENT
# ==========================================

@app.post("/api/users", tags=["users"])
async def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db)
):
    """
    Creates a new user record in the database without any biometric data.
    """
    db_user = db.query(User).filter(User.username == payload.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    
    new_user = User(username=payload.username)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    return {"status": "success", "message": f"User '{new_user.username}' created with ID {new_user.id}."}

@app.get("/api/users", response_model=List[UserSummary], summary="List users and their authentication setup", tags=["users"])
async def list_users(db: Session = Depends(get_db)):
    """
    Returns every user with the authentication sequence configured for them and the
    modalities they are actually enrolled in. Read-only: no biometric template is exposed.
    """
    users = db.query(User).order_by(User.username).all()
    profiles = {p.user_id: p for p in db.query(BiometricProfile).all()}
    return [
        UserSummary(
            id=user.id,
            username=user.username,
            required_factors=user.required_factors or {},
            enrolled_factors=_get_available_factors(profiles.get(user.id)),
        )
        for user in users
    ]

@app.get("/api/users/{username}", response_model=UserSummary, summary="Get a single user's authentication setup", tags=["users"])
async def get_user(username: str, db: Session = Depends(get_db)):
    """
    Same payload as /api/users, for a single username. Lets a client know which factors
    will be requested before starting a session.
    """
    db_user = db.query(User).filter(User.username == username).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    profile = db.query(BiometricProfile).filter(BiometricProfile.user_id == db_user.id).first()
    return UserSummary(
        id=db_user.id,
        username=db_user.username,
        required_factors=db_user.required_factors or {},
        enrolled_factors=_get_available_factors(profile),
    )

@app.put("/api/users/{username}", tags=["users"])
async def update_user(
    username: str,
    payload: UserUpdate,
    db: Session = Depends(get_db)
):
    """
    Updates a user's settings, such as the number of required authentication factors.
    """
    db_user = db.query(User).filter(User.username == username).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    valid_factors = {"voice", "gesture", "haptic"}
    for key, value in payload.required_factors.items():
        if not key.isdigit() or int(key) < 1:
            raise HTTPException(status_code=400, detail="Las claves de los factores deben ser enteros positivos como strings (ej: '1', '2').")
        if value not in valid_factors:
            raise HTTPException(status_code=400, detail=f"Factor inválido '{value}'. Debe ser uno de {sorted(valid_factors)}.")

    # La secuencia tiene que ser 1..N sin huecos: el flujo avanza contando factores
    # completados, así que un salto de '1' a '3' dejaría la sesión sin siguiente paso.
    keys = sorted(int(k) for k in payload.required_factors)
    if keys != list(range(1, len(keys) + 1)):
        raise HTTPException(
            status_code=400,
            detail=f"La secuencia debe ser consecutiva desde 1. Recibido: {keys}.",
        )

    if len(set(payload.required_factors.values())) != len(payload.required_factors):
        raise HTTPException(status_code=400, detail="No se puede repetir el mismo factor en la secuencia.")

    db_user.required_factors = payload.required_factors
    db.commit()
    
    return {"status": "success", "message": f"User '{username}' updated. Required factors set to {payload.required_factors}."}

# ==========================================
# 8. NEW ENROLLMENT/VERIFICATION ENDPOINTS
# ==========================================
VOICE_ACCEPTANCE_THRESHOLD = 0.55

@app.post("/api/enroll", tags=["enrollment"])
async def enroll_user(
    username: str = Form(...), 
    audio: UploadFile = File(...), 
    db: Session = Depends(get_db)
):
    """
    Enrolls a new user by creating a voice embedding from an audio file.
    If the user already exists, it overwrites their biometric profile.
    """
    db_user = db.query(User).filter(User.username == username).first()
    if not db_user:
        db_user = User(username=username)
        db.add(db_user)
        db.commit()
        db.refresh(db_user)

    audio_bytes = await audio.read()
    voice_embedding = extract_voice_embedding(audio_bytes)

    profile = db.query(BiometricProfile).filter(BiometricProfile.user_id == db_user.id).first()
    if not profile:
        profile = BiometricProfile(
            user_id=db_user.id, 
            voice_embedding=voice_embedding,
            voice_audio=audio_bytes
        )
    else:
        profile.voice_embedding = voice_embedding
        profile.voice_audio = audio_bytes
        
    db.add(profile)
    db.commit()
    return {"status": "success", "message": f"User {username} enrolled successfully."}

@app.post("/api/verify", tags=["enrollment"])
async def verify_user_voice(
    session_id: str = Form(...),
    audio: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    session, db_user, profile = _get_valid_session_data(session_id, db)

    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    profile = db.query(BiometricProfile).filter(BiometricProfile.user_id == db_user.id).first()
    if not profile or not profile.voice_embedding:
        raise HTTPException(status_code=400, detail="User does not have a registered biometric profile")

    audio_bytes = await audio.read()
    live_embedding = extract_voice_embedding(audio_bytes)
    similarity_score = compare_embeddings(profile.voice_embedding, live_embedding)

    is_match = similarity_score >= VOICE_ACCEPTANCE_THRESHOLD and similarity_score < 0.99

    return _update_session_and_get_response(
        session=session,
        db_user=db_user,
        profile=profile,
        modality="voice",
        is_match=is_match,
        score=similarity_score,
        db=db
    )

@app.post("/api/enroll/gesture", tags=["enrollment", "gesture"])
async def enroll_gesture(
    payload: GestureEnrollPayload,
    db: Session = Depends(get_db)
):
    """
    Enrolls a user by creating a gesture embedding from a sequence of points.
    The embedding captures the shape and kinematics (speed, acceleration) of the gesture.
    """
    username = payload.username
    db_user = db.query(User).filter(User.username == username).first()
    if not db_user:
        db_user = User(username=username)
        db.add(db_user)
        db.commit()
        db.refresh(db_user)

    # Generate the embedding for verification
    gesture_embedding = extract_gesture_embedding(payload.points)
    # Generate and store normalized points for visualization
    gesture_points_for_viz = _get_normalized_gesture_points(payload.points)

    profile = db.query(BiometricProfile).filter(BiometricProfile.user_id == db_user.id).first()
    if not profile:
        profile = BiometricProfile(user_id=db_user.id, gesture_embedding=gesture_embedding, gesture_points=gesture_points_for_viz)
    else:
        profile.gesture_embedding = gesture_embedding
        profile.gesture_points = gesture_points_for_viz
        
    db.add(profile)
    db.commit()
    return {"status": "success", "message": f"Gesture for user {username} enrolled successfully."}

@app.post("/api/verify/gesture", response_model=VerificationResponse, summary="Verify user's gesture against their enrolled template", tags=["verify", "gesture"])
async def verify_user_gesture(
    payload: GestureSubmission,
    db: Session = Depends(get_db)
):
    """
    Verifies a live gesture as part of an authentication session.
    """
    session, db_user, profile = _get_valid_session_data(payload.session_id, db)

    if not profile.gesture_embedding:
        raise HTTPException(status_code=400, detail="User does not have a registered gesture profile")

    live_embedding = extract_gesture_embedding(payload.points)
    similarity_score = compare_embeddings(profile.gesture_embedding, live_embedding)
    is_match = similarity_score >= GESTURE_ACCEPTANCE_THRESHOLD

    return _update_session_and_get_response(
        session=session,
        db_user=db_user,
        profile=profile,
        modality="gesture",
        is_match=is_match,
        score=similarity_score,
        db=db
    )

@app.post("/api/enroll/haptic", tags=["enrollment", "haptic"])
async def enroll_haptic(payload: HapticEnrollPayload, db: Session = Depends(get_db)):
    """
    Registra el secreto háptico de un usuario.

    Sólo se guarda la derivación con sal: el secreto en claro no queda en la base, ni
    siquiera cifrado de forma reversible. A diferencia de la voz o el gesto, si se filtra
    se puede revocar y volver a enrolar otro.
    """
    _validate_haptic_secret(payload.secret)

    db_user = db.query(User).filter(User.username == payload.username).first()
    if not db_user:
        db_user = User(username=payload.username)
        db.add(db_user)
        db.commit()
        db.refresh(db_user)

    salt = secrets.token_hex(16)
    digest = _hash_haptic_secret(payload.secret, salt)

    profile = db.query(BiometricProfile).filter(BiometricProfile.user_id == db_user.id).first()
    if not profile:
        profile = BiometricProfile(user_id=db_user.id)

    profile.haptic_hash = digest
    profile.haptic_salt = salt
    profile.haptic_length = len(payload.secret)
    profile.haptic_alphabet = HAPTIC_SYMBOLS.copy()

    db.add(profile)
    db.commit()
    return {
        "status": "success",
        "message": f"Secreto háptico de {payload.username} registrado ({len(payload.secret)} símbolos).",
        "nota": "El secreto no se devuelve nunca: en la base sólo queda su derivación con sal.",
    }


@app.post(
    "/api/auth/haptic/challenge",
    response_model=HapticChallengeResponse,
    summary="Issue a fresh haptic challenge for the current session",
    tags=["auth", "haptic"],
)
async def request_haptic_challenge(session_id: str = Form(...), db: Session = Depends(get_db)):
    """
    Emite una permutación nueva por ronda.

    Las permutaciones no son secretas —el cliente necesita conocerlas para reproducir los
    patrones— pero cambian en cada emisión, y son ellas las que traducen las ranuras
    elegidas de vuelta a símbolos. Por eso una respuesta capturada no se puede reutilizar.
    """
    session, db_user, profile = _get_valid_session_data(session_id, db)

    if not profile or not profile.haptic_hash:
        raise HTTPException(status_code=400, detail="El usuario no tiene un secreto háptico registrado")

    # Un secreto enrolado con otro alfabeto no se puede reproducir con el actual: fallaría
    # en cada intento sin que nada indique la causa. Preferimos negarnos y explicarlo.
    enrolled_alphabet = profile.haptic_alphabet
    if enrolled_alphabet is not None and enrolled_alphabet != HAPTIC_SYMBOLS:
        raise HTTPException(
            status_code=409,
            detail=(
                f"El secreto háptico se registró con otro alfabeto ({enrolled_alphabet}) y el "
                f"actual es {HAPTIC_SYMBOLS}. Hay que volver a registrarlo desde /admin/haptic."
            ),
        )
    if enrolled_alphabet is None:
        raise HTTPException(
            status_code=409,
            detail=(
                "El secreto háptico se registró con una versión anterior del alfabeto. "
                "Hay que volver a registrarlo desde /admin/haptic."
            ),
        )

    # El desafío sólo se emite si el háptico es realmente el factor que toca ahora.
    expected_key = str(len(session.completed_factors) + 1)
    if (db_user.required_factors or {}).get(expected_key) != "haptic":
        raise HTTPException(status_code=400, detail="El factor háptico no es el siguiente en la secuencia")

    challenge = _build_haptic_challenge(profile.haptic_length or 4)
    session.haptic_challenge = challenge
    db.commit()

    return {"session_id": session_id, "symbols": HAPTIC_SYMBOLS, "rounds": challenge}


@app.post(
    "/api/verify/haptic",
    response_model=VerificationResponse,
    summary="Verify the haptic secret against the issued challenge",
    tags=["verify", "haptic"],
)
async def verify_user_haptic(payload: HapticSubmission, db: Session = Depends(get_db)):
    session, db_user, profile = _get_valid_session_data(payload.session_id, db)

    if not profile or not profile.haptic_hash:
        raise HTTPException(status_code=400, detail="El usuario no tiene un secreto háptico registrado")

    challenge = session.haptic_challenge
    if not challenge:
        raise HTTPException(status_code=400, detail="No hay un desafío háptico emitido para esta sesión")

    # Un desafío se usa una sola vez, pase o falle: si no, una respuesta correcta capturada
    # se podría reenviar mientras la permutación siguiera viva.
    session.haptic_challenge = None

    if len(payload.selections) != len(challenge):
        db.commit()
        raise HTTPException(
            status_code=400,
            detail=f"Se esperaban {len(challenge)} respuestas y llegaron {len(payload.selections)}.",
        )

    if any(not 0 <= choice < len(HAPTIC_SYMBOLS) for choice in payload.selections):
        db.commit()
        raise HTTPException(status_code=400, detail="Alguna ranura elegida está fuera de rango.")

    # Traducimos ranuras a símbolos con la permutación que emitió el servidor.
    attempt = [permutation[choice] for permutation, choice in zip(challenge, payload.selections)]
    digest = _hash_haptic_secret(attempt, profile.haptic_salt)
    is_match = secrets.compare_digest(digest, profile.haptic_hash)

    # Un factor de conocimiento no tiene similitud: acierta o no. Informamos 1.0 / 0.0 para
    # mantener el mismo contrato que voz y gesto, no porque haya una medida de parecido.
    return _update_session_and_get_response(
        session=session,
        db_user=db_user,
        profile=profile,
        modality="haptic",
        is_match=is_match,
        score=1.0 if is_match else 0.0,
        db=db,
    )


@app.get("/api/haptic/{username}", tags=["enrollment", "haptic"])
async def get_user_haptic(username: str, db: Session = Depends(get_db)):
    """Metadatos del secreto háptico. Nunca devuelve el secreto ni su hash."""
    db_user = db.query(User).filter(User.username == username).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    profile = db.query(BiometricProfile).filter(BiometricProfile.user_id == db_user.id).first()
    if not profile or not profile.haptic_hash:
        raise HTTPException(status_code=404, detail="El usuario no tiene un secreto háptico registrado")

    enrolled = profile.haptic_alphabet
    return {
        "username": username,
        "length": profile.haptic_length,
        # `alphabet` es el conjunto de símbolos DISPONIBLES, no el secreto del usuario.
        # Antes se llamaba `symbols` y se leía como si fuera lo que la persona había
        # guardado, que es exactamente lo contrario de lo que este endpoint devuelve.
        "alphabet": HAPTIC_SYMBOLS,
        "alphabet_al_enrolar": enrolled,
        "necesita_reenrolar": enrolled != HAPTIC_SYMBOLS,
        "nota": "El secreto no se devuelve nunca: en la base sólo queda su derivación con sal.",
    }


@app.post("/api/auth/start", tags=["auth"])
async def start_authentication_session(username: str = Form(...), db: Session = Depends(get_db)):
    """
    Starts a new authentication session for a user.
    """
    db_user = db.query(User).filter(User.username == username).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    session_id = uuid.uuid4().hex
    expires_at = datetime.utcnow() + timedelta(minutes=5)

    new_session = AuthSession(
        session_id=session_id,
        user_id=db_user.id,
        expires_at=expires_at,
        completed_factors=[]
    )
    db.add(new_session)
    db.commit()

    required_factors_dict = db_user.required_factors
    if not required_factors_dict or "1" not in required_factors_dict:
        raise HTTPException(status_code=400, detail="El usuario no tiene factores de autenticación configurados.")
    
    first_factor = required_factors_dict["1"]

    return {
        "session_id": session_id,
        "status": "challenge",
        "message": f"Authentication session started. Please provide the first factor: {first_factor}.",
        "required_factors": required_factors_dict,
        "completed_factors": [],
        "next_factors": [first_factor],
        "expires_at": expires_at.isoformat() + "Z"
    }

def _get_valid_session_data(session_id: str, db: Session):
    session = db.query(AuthSession).filter(AuthSession.session_id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status != "pending":
        raise HTTPException(status_code=400, detail=f"Session is already {session.status}")
    if datetime.utcnow() > session.expires_at:
        session.status = "expired"
        db.commit()
        raise HTTPException(status_code=400, detail="Session has expired")
    
    user = db.query(User).filter(User.id == session.user_id).first()
    profile = db.query(BiometricProfile).filter(BiometricProfile.user_id == user.id).first()
    return session, user, profile

def _get_available_factors(profile: BiometricProfile) -> List[str]:
    factors = []
    if profile:
        if profile.voice_embedding:
            factors.append("voice")
        if profile.gesture_embedding:
            factors.append("gesture")
        if profile.haptic_hash:
            factors.append("haptic")
    return factors

def _update_session_and_get_response(session: AuthSession, db_user: User, profile: BiometricProfile, modality: str, is_match: bool, score: float, db: Session):
    if not is_match:
        session.status = "failed"
        decision = "denied"
        message = f"Verification for '{modality}' failed. Score: {score:.2f}"
        next_factors = []
    else:
        # Check if the provided modality was the one expected in the sequence
        required_factors_dict = db_user.required_factors
        current_completed_count = len(session.completed_factors)
        expected_factor_key = str(current_completed_count + 1)

        if expected_factor_key not in required_factors_dict or required_factors_dict[expected_factor_key] != modality:
            session.status = "failed"
            decision = "denied"
            message = f"Factor incorrecto. Se esperaba '{required_factors_dict.get(expected_factor_key, 'N/A')}' pero se recibió '{modality}'."
            next_factors = []
        else:
            # Correct factor provided, proceed
            completed = list(set(session.completed_factors + [modality]))
            session.completed_factors = completed
            
            if len(completed) >= len(required_factors_dict):
                session.status = "completed"
                decision = "authorized"
                message = "Todos los factores requeridos han sido verificados. Acceso autorizado."
                next_factors = []
            else:
                decision = "challenge"
                next_factor_key = str(len(completed) + 1)
                next_factor_value = required_factors_dict[next_factor_key]
                message = f"Factor '{modality}' verificado. Siguiente factor requerido: {next_factor_value}."
                next_factors = [next_factor_value]

    log_entry = AuthLog(user_id=db_user.id, modality=modality, similarity_score=score, decision=decision)
    db.add(log_entry)
    db.commit()

    return {
        "session_id": session.session_id,
        "status": decision,
        "message": message,
        "score": round(score, 4),
        "completed_factors": session.completed_factors,
        "next_factors": next_factors
    }

@app.get("/api/audio/{username}", tags=["enrollment"])
async def get_user_audio(username: str, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.username == username).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    profile = db.query(BiometricProfile).filter(BiometricProfile.user_id == db_user.id).first()
    if not profile or not profile.voice_audio:
        raise HTTPException(status_code=404, detail="El usuario no tiene un audio de voz registrado")

    return Response(content=profile.voice_audio, media_type="audio/wav")
    
@app.get("/api/gesture/{username}", tags=["enrollment", "gesture"])
async def get_user_gesture(username: str, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.username == username).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    profile = db.query(BiometricProfile).filter(BiometricProfile.user_id == db_user.id).first()
    if not profile or not profile.gesture_points:
        raise HTTPException(status_code=404, detail="El usuario no tiene un patrón de gesto registrado para visualizar.")

    return {"gesture_points": profile.gesture_points}


@app.get("/api/logs", tags=["enrollment"])
async def get_audit_logs(db: Session = Depends(get_db)):
    logs = db.query(AuthLog).all()
    return logs

# ==========================================
# 9. ADMIN PANEL
# ==========================================
security = HTTPBasic()

def get_current_username(credentials: HTTPBasicCredentials = Depends(security)):
    correct_username = secrets.compare_digest(credentials.username, "admin")
    correct_password = secrets.compare_digest(credentials.password, "admin")
    if not (correct_username and correct_password):
        raise HTTPException(
            status_code=401,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username

@app.get("/admin", include_in_schema=False)
async def get_admin_index(username: str = Depends(get_current_username)):
    return FileResponse('static/index.html')

@app.get("/admin/user", include_in_schema=False)
async def get_user_creation_panel(username: str = Depends(get_current_username)):
    return FileResponse('static/user.html')

@app.get("/admin/voice", include_in_schema=False)
async def get_voice_panel(username: str = Depends(get_current_username)):
    return FileResponse('static/voice.html')

@app.get("/admin/gesture", include_in_schema=False)
async def get_gesture_panel(username: str = Depends(get_current_username)):
    return FileResponse('static/gesture.html')

@app.get("/admin/haptic", include_in_schema=False)
async def get_haptic_panel(username: str = Depends(get_current_username)):
    return FileResponse('static/haptic.html')

@app.get("/admin/mfa", include_in_schema=False)
async def get_mfa_panel(username: str = Depends(get_current_username)):
    return FileResponse('static/mfa.html')

@app.get("/.well-known/appspecific/com.chrome.devtools.json", include_in_schema=False)
async def get_chrome_devtools_json():
    return FileResponse('com.chrome.devtools.json')
