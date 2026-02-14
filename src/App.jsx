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

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

export default function App() {
  const mpLink = import.meta.env.VITE_MP_LINK || "";

  const [mode, setMode] = useState("home");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");

  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState(null);
  const [rounds, setRounds] = useState([]);

  const roomIdRef = useRef(null);

  const isInRoom = useMemo(() => mode === "room" && roomCode, [mode, roomCode]);

  // 🔥 IMPORTANTE: NO entrar directo con ?room
  useEffect(() => {
    const initial = getRoomFromQuery();
    if (initial) {
      setJoinCode(initial);
      setRoomCode(initial);
      setMode("home");
    }
  }, []);

  async function loadRoomAndRounds(code) {
    setError("");
    try {
      const { data: roomData, error: roomErr } = await supabase.rpc("get_room", {
        p_code: code,
      });
      if (roomErr) throw roomErr;

      const r = roomData?.[0];
      if (!r) throw new Error("Sala no encontrada");

      setRoom(r);
      roomIdRef.current = r.room_id;

      const { data: roundsData } = await supabase
        .from("rounds")
        .select("id, result, created_at")
        .eq("room_id", r.room_id)
        .order("created_at", { ascending: false })
        .limit(50);

      setRounds(roundsData || []);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    if (mode === "room" && roomCode) {
      loadRoomAndRounds(roomCode);
    }
  }, [mode, roomCode]);

  // Realtime
  useEffect(() => {
    if (!isInRoom || !roomIdRef.current) return;

    const roomId = roomIdRef.current;

    const channel = supabase
      .channel(`volados_room_${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${roomId}`,
        },
        (payload) => {
          const newRow = payload.new;
          if (newRow) {
            setRoom((prev) => ({
              ...(prev || {}),
              room_id: newRow.id,
              code: newRow.code,
              player1_name: newRow.player1_name,
              player2_name: newRow.player2_name,
              status: newRow.status,
              created_at: newRow.created_at,
              updated_at: newRow.updated_at,
            }));
          }
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
          const newRound = payload.new;
          if (newRound) {
            setRounds((prev) => [newRound, ...(prev || [])].slice(0, 50));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isInRoom, room?.room_id]);

  async function onCreateRoom() {
    if (!name.trim()) return setError("Escribe tu nombre.");

    setBusy(true);
    try {
      const { data } = await supabase.rpc("create_room", {
        p_player1_name: name.trim(),
      });

      const created = data?.[0];
      const code = created.code.toUpperCase();

      setRoomCode(code);
      setRoomInQuery(code);
      setMode("room");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function onJoinRoom() {
    if (!name.trim()) return setError("Escribe tu nombre.");
    if (!joinCode.trim()) return setError("Escribe el código.");

    setBusy(true);
    try {
      const { data } = await supabase.rpc("join_room", {
        p_code: joinCode.trim(),
        p_player2_name: name.trim(),
      });

      const joined = data?.[0];
      const code = joined.code.toUpperCase();

      setRoomCode(code);
      setRoomInQuery(code);
      setMode("room");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function onFlip() {
    if (!roomCode) return;

    setBusy(true);
    try {
      await supabase.rpc("flip_coin", {
        p_code: roomCode,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function copyInviteLink() {
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomCode);
    navigator.clipboard?.writeText(url.toString());
  }

  function onLeave() {
    setMode("home");
    setRoom(null);
    roomIdRef.current = null;
    setRounds([]);
    setJoinCode("");
    setRoomCode("");
    setRoomInQuery("");
  }

  const canFlip = !!room?.player2_name && room?.status === "ready";

  return (
    <div style={{ padding: 20 }}>
      <h2>Volados</h2>

      {error && <p style={{ color: "red" }}>{error}</p>}

      {mode === "home" && (
        <>
          <input
            placeholder="Tu nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <br /><br />

          <button onClick={onCreateRoom} disabled={busy}>
            Crear sala
          </button>

          <br /><br />

          <input
            placeholder="Código"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          />
          <button onClick={onJoinRoom} disabled={busy}>
            Unirse
          </button>
        </>
      )}

      {mode === "room" && (
        <>
          <p>Sala: <b>{roomCode}</b></p>
          <p>Jugador 1: {room?.player1_name}</p>
          <p>Jugador 2: {room?.player2_name || "Esperando..."}</p>

          <button onClick={copyInviteLink}>Copiar link</button>
          <button onClick={onLeave}>Salir</button>

          <br /><br />

          <button onClick={onFlip} disabled={!canFlip || busy}>
            Lanzar moneda
          </button>

          <h4>Historial</h4>
          {rounds.map((r) => (
            <div key={r.id}>
              {r.result} - {formatTime(r.created_at)}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
