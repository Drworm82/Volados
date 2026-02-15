import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabase";

function getRoomFromQuery() {
  const url = new URL(window.location.href);
  const room = url.searchParams.get("room");
  return room ? room.toUpperCase().trim() : "";
}

function setRoomInQuery(code) {
  const url = new URL(window.location.href);
  if (!code) url.searchParams.delete("room");
  else url.searchParams.set("room", code.toUpperCase().trim());
  window.history.replaceState({}, "", url.toString());
}

export default function App() {
  const mpLink = import.meta.env.VITE_MP_LINK || "";

  const [mode, setMode] = useState("home");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState(getRoomFromQuery());

  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState(null);
  const [rounds, setRounds] = useState([]);
  const [myChoice, setMyChoice] = useState(null);

  const roomIdRef = useRef(null);

  const isInRoom = useMemo(
    () => mode === "room" && roomCode,
    [mode, roomCode]
  );

  // 🚫 IMPORTANTE: NO entrar directo si hay ?room
  useEffect(() => {
    const initial = getRoomFromQuery();
    if (initial) {
      setJoinCode(initial);
      setMode("home");
    }
  }, []);

  useEffect(() => {
    if (mode === "room" && roomCode) {
      loadRoom(roomCode);
    }
  }, [mode, roomCode]);

  async function loadRoom(code) {
    setError("");

    const { data, error } = await supabase.rpc("get_room", {
      p_code: code,
    });

    if (error) return setError(error.message);

    const r = data?.[0];
    if (!r) return setError("Sala no encontrada");

    setRoom(r);
    roomIdRef.current = r.room_id;

    const { data: roundsData } = await supabase
      .from("rounds")
      .select("*")
      .eq("room_id", r.room_id)
      .order("created_at", { ascending: false });

    setRounds(roundsData || []);
  }

  // Realtime
  useEffect(() => {
    if (!roomIdRef.current) return;

    const roomId = roomIdRef.current;

    const channel = supabase
      .channel(`room_${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${roomId}`,
        },
        (payload) => {
          setRoom((prev) => ({
            ...prev,
            ...payload.new,
          }));
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "rounds",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          setRounds((prev) => [payload.new, ...prev]);
          setMyChoice(null);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [room?.room_id]);

  async function onCreateRoom() {
    if (!name.trim()) return setError("Escribe tu nombre.");

    setBusy(true);

    const { data, error } = await supabase.rpc("create_room", {
      p_player1_name: name.trim(),
    });

    if (error) {
      setBusy(false);
      return setError(error.message);
    }

    const code = data[0].code.toUpperCase();

    setRoomCode(code);
    setRoomInQuery(code);
    setMode("room");
    setBusy(false);
  }

  async function onJoinRoom() {
    if (!name.trim()) return setError("Escribe tu nombre.");
    if (!joinCode.trim()) return setError("Código requerido.");

    setBusy(true);

    const code = joinCode.trim().toUpperCase();

    const { error } = await supabase.rpc("join_room", {
      p_code: code,
      p_player2_name: name.trim(),
    });

    if (error) {
      setBusy(false);
      return setError(error.message);
    }

    setRoomCode(code);
    setRoomInQuery(code);
    setMode("room");
    setBusy(false);
  }

  async function choose(choice) {
    if (!name.trim()) return setError("Nombre requerido.");

    setMyChoice(choice);

    await supabase.rpc("choose_side", {
      p_code: roomCode,
      p_player_name: name.trim(),
      p_choice: choice,
    });
  }

  async function onFlip() {
    setBusy(true);

    const { error } = await supabase.rpc("flip_coin", {
      p_code: roomCode,
    });

    if (error) setError(error.message);

    setBusy(false);
  }

  const bothReady =
    room?.player1_choice && room?.player2_choice;

  return (
    <div className="container">
      <div className="card">
        <h2>Volados</h2>

        {mode === "home" && (
          <>
            <input
              placeholder="Tu nombre"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            <button onClick={onCreateRoom} disabled={busy}>
              Crear sala
            </button>

            <hr />

            <input
              placeholder="Código"
              value={joinCode}
              onChange={(e) =>
                setJoinCode(e.target.value.toUpperCase())
              }
            />

            <button onClick={onJoinRoom} disabled={busy}>
              Unirse
            </button>

            {mpLink && (
              <div className="footer">
                <a href={mpLink} target="_blank" rel="noreferrer">
                  ☕ Invítame un café
                </a>
              </div>
            )}
          </>
        )}

        {mode === "room" && room && (
          <>
            <p>
              Sala: <b>{roomCode}</b>
            </p>

            <p>
              {room.player1_name}{" "}
              {room.player1_choice ? "✔ listo" : ""}
            </p>

            <p>
              {room.player2_name || "Esperando..."}{" "}
              {room.player2_choice ? "✔ listo" : ""}
            </p>

            {!myChoice && !bothReady && (
              <div>
                <button onClick={() => choose("aguila")}>
                  🦅 Águila
                </button>

                <button onClick={() => choose("sol")}>
                  🌞 Sol
                </button>
              </div>
            )}

            {bothReady && (
              <button onClick={onFlip} disabled={busy}>
                Lanzar moneda
              </button>
            )}

            <h3>Historial</h3>

            {rounds.map((r) => (
              <div key={r.id}>
                {r.result?.toUpperCase()}
              </div>
            ))}
          </>
        )}

        {error && <p style={{ color: "red" }}>{error}</p>}
      </div>
    </div>
  );
}
