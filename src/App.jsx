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

  const isInRoom = useMemo(() => mode === "room" && roomCode, [mode, roomCode]);

  async function loadRoomAndRounds(code) {
    setBusy(true);
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

      const { data: roundsData, error: roundsErr } = await supabase
        .from("rounds")
        .select("id, result, created_at")
        .eq("room_id", r.room_id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (roundsErr) throw roundsErr;
      setRounds(roundsData || []);
    } catch (e) {
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
          if (payload.new) {
            setRoom((prev) => ({
              ...(prev || {}),
              room_id: payload.new.id,
              code: payload.new.code,
              player1_name: payload.new.player1_name,
              player2_name: payload.new.player2_name,
              status: payload.new.status,
              created_at: payload.new.created_at,
              updated_at: payload.new.updated_at,
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
          if (payload.new) {
            setRounds((prev) => [payload.new, ...(prev || [])].slice(0, 50));
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
      const { data, error } = await supabase.rpc("create_room", {
        p_player1_name: n,
      });
      if (error) throw error;

      const created = data?.[0];
      const code = created?.code?.toUpperCase();
      if (!code) throw new Error("No se pudo crear la sala");

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

  async function onJoinRoom() {
    setError("");
    const n = name.trim();
    const code = (joinCode || roomCode).trim().toUpperCase();

    if (!n) return setError("Escribe tu nombre.");
    if (!code) return setError("Escribe el código.");

    setBusy(true);

    try {
      const { data, error } = await supabase.rpc("join_room", {
        p_code: code,
        p_player2_name: n,
      });
      if (error) throw error;

      setRoomCode(code);
      setRoomInQuery(code);
      setMode("room");
      await loadRoomAndRounds(code);
    } catch (e) {
      setError(e?.message || "Error uniéndose");
    } finally {
      setBusy(false);
    }
  }

  async function onFlip() {
    setError("");
    setBusy(true);

    try {
      const { error } = await supabase.rpc("flip_coin", {
        p_code: roomCode,
      });
      if (error) throw error;
      // NO agregamos round manualmente
      // Realtime lo insertará
    } catch (e) {
      setError(e?.message || "Error lanzando moneda");
    } finally {
      setBusy(false);
    }
  }

  function onLeave() {
    setMode("home");
    setRoom(null);
    setRounds([]);
    roomIdRef.current = null;
    setRoomCode("");
    setRoomInQuery("");
  }

  function copyInviteLink() {
    const url = `${window.location.origin}?room=${roomCode}`;
    navigator.clipboard?.writeText(url);
  }

  function shareInviteLink() {
    const url = `${window.location.origin}?room=${roomCode}`;
    if (navigator.share) {
      navigator.share({
        title: "Volados",
        text: "Únete a mi sala",
        url,
      });
    } else {
      copyInviteLink();
    }
  }

  const canFlip = !!room?.player2_name && room?.status === "ready";

  return (
    <div className="container">
      <div className="card">
        <h2>Volados</h2>

        {error && <p style={{ color: "red" }}>{error}</p>}

        {mode === "home" && (
          <>
            <input
              placeholder="Tu nombre"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            <div style={{ marginTop: 10 }}>
              <button onClick={onCreateRoom} disabled={busy}>
                Crear sala
              </button>
            </div>

            <div style={{ marginTop: 10 }}>
              <input
                placeholder="Código"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
              />
              <button onClick={onJoinRoom} disabled={busy}>
                Unirse
              </button>
            </div>
          </>
        )}

        {mode === "room" && (
          <>
            <p><b>Sala:</b> {roomCode}</p>
            <p><b>Jugador 1:</b> {room?.player1_name}</p>
            <p><b>Jugador 2:</b> {room?.player2_name || "Esperando..."}</p>

            <button onClick={copyInviteLink}>Copiar link</button>
            <button onClick={shareInviteLink}>Compartir</button>

            <div style={{ marginTop: 15 }}>
              <button onClick={onFlip} disabled={!canFlip || busy}>
                Lanzar moneda
              </button>
            </div>

            <div style={{ marginTop: 15 }}>
              <h4>Historial</h4>
              {rounds.map((r) => (
                <div key={r.id}>
                  {r.result} - {formatTime(r.created_at)}
                </div>
              ))}
            </div>

            <button style={{ marginTop: 20 }} onClick={onLeave}>
              Salir
            </button>
          </>
        )}
      </div>
    </div>
  );
}
