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

  const [roomCode, setRoomCode] = useState(getRoomFromQuery());
  const [room, setRoom] = useState(null);

  const [rounds, setRounds] = useState([]);

  const roomIdRef = useRef(null);

  const isInRoom = useMemo(
    () => mode === "room" && roomCode,
    [mode, roomCode]
  );

  async function loadRoomAndRounds(code) {
    setError("");
    setBusy(true);
    try {
      const { data: roomData, error: roomErr } = await supabase.rpc(
        "get_room",
        { p_code: code }
      );
      if (roomErr) throw roomErr;

      const r = roomData?.[0];
      if (!r) throw new Error("Sala no encontrada");

      setRoom(r);
      roomIdRef.current = r.room_id;

      const { data: roundsData, error: roundsErr } = await supabase
        .from("rounds")
        .select("id, result, created_at")
        .eq("room_id", r.room_id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (roundsErr) throw roundsErr;
      setRounds(roundsData || []);
    } catch (e) {
      setRoom(null);
      roomIdRef.current = null;
      setRounds([]);
      setError(e?.message || "Error cargando sala");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const initial = getRoomFromQuery();
    if (initial) {
      setMode("room");
      setRoomCode(initial);
    }
  }, []);

  useEffect(() => {
    if (mode === "room" && roomCode) {
      loadRoomAndRounds(roomCode);
    }
  }, [mode, roomCode]);

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
    setError("");
    const n = name.trim();
    if (!n) return setError("Escribe tu nombre.");
    setBusy(true);

    try {
      const { data, error: rpcErr } = await supabase.rpc("create_room", {
        p_player1_name: n,
      });
      if (rpcErr) throw rpcErr;

      const created = data?.[0];
      if (!created?.code)
        throw new Error("No se pudo crear la sala");

      const code = created.code.toUpperCase();
      setRoomCode(code);
      setRoomInQuery(code);
      setMode("room");
      await loadRoomAndRounds(code);
    } catch (e) {
      setError(e?.message || "Error creando sala");
    } finally {
      setBusy(false);
    }
  }

  // 🔥 CORREGIDO AQUÍ
  async function onJoinRoom() {
    setError("");
    const n = name.trim();
    const code = (joinCode || roomCode).trim().toUpperCase();

    if (!n) return setError("Escribe tu nombre.");
    if (!code) return setError("Escribe el código.");

    setBusy(true);
    try {
      const { error: rpcErr } = await supabase.rpc("join_room", {
        p_code: code,
        p_player2_name: n,
      });
      if (rpcErr) throw rpcErr;

      setRoomCode(code);
      setRoomInQuery(code);
      setMode("room");
      await loadRoomAndRounds(code);
    } catch (e) {
      setError(e?.message || "Error uniéndose a sala");
    } finally {
      setBusy(false);
    }
  }

  async function onFlip() {
    setError("");
    if (!roomCode) return;
    setBusy(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc(
        "flip_coin",
        { p_code: roomCode }
      );
      if (rpcErr) throw rpcErr;

      const round = data?.[0];
      if (round) {
        setRounds((prev) => [round, ...(prev || [])].slice(0, 50));
      }
    } catch (e) {
      setError(e?.message || "Error lanzando moneda");
    } finally {
      setBusy(false);
    }
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

  function copyInviteLink() {
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomCode);
    navigator.clipboard?.writeText(url.toString()).catch(() => {});
  }

  const canFlip =
    !!room?.player2_name && room?.status === "ready";

  return (
    <div className="container">
      <div className="card">
        <h2>Volados</h2>

        {error && <div style={{ color: "red" }}>{error}</div>}

        {mode === "home" && (
          <>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tu nombre"
            />

            <button onClick={onCreateRoom} disabled={busy}>
              Crear sala
            </button>

            <input
              value={joinCode}
              onChange={(e) =>
                setJoinCode(e.target.value.toUpperCase())
              }
              placeholder="Código"
            />
            <button onClick={onJoinRoom} disabled={busy}>
              Unirse
            </button>
          </>
        )}

        {mode === "room" && (
          <>
            <p>
              Sala: <b>{roomCode}</b>
            </p>
            <p>
              {room?.player1_name} vs{" "}
              {room?.player2_name || "Esperando..."}
            </p>

            <button
              onClick={onFlip}
              disabled={busy || !canFlip}
            >
              Lanzar moneda
            </button>

            <h4>Historial</h4>
            {rounds.map((r) => (
              <div key={r.id}>
                {r.result} - {formatTime(r.created_at)}
              </div>
            ))}

            <button onClick={onLeave}>Salir</button>
          </>
        )}
      </div>
    </div>
  );
}
