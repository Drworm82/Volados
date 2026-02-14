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
  const mpLink = import.meta.env.VITE_MP_LINK || ""; // placeholder configurable

  const [mode, setMode] = useState("home"); // home | room
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
    setError("");
    setBusy(true);
    try {
      // RPC: get_room
      const { data: roomData, error: roomErr } = await supabase.rpc("get_room", {
        p_code: code,
      });
      if (roomErr) throw roomErr;

      const r = roomData?.[0];
      if (!r) throw new Error("Sala no encontrada");

      setRoom(r);
      roomIdRef.current = r.room_id;

      // Cargar historial
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

  // Entrar automáticamente si viene ?room=XXXXX
  useEffect(() => {
    const initial = getRoomFromQuery();
    if (initial) {
      setMode("room");
      setRoomCode(initial);
    }
  }, []);

  // Si está en room, cargar datos
  useEffect(() => {
    if (mode === "room" && roomCode) {
      loadRoomAndRounds(roomCode);
    }
  }, [mode, roomCode]);

  // Realtime subscriptions (room updates + new rounds)
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
          // Refresca estado room (simple)
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
  }, [isInRoom, room?.room_id]); // room?.room_id cambia cuando se recarga

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
      if (!created?.code) throw new Error("No se pudo crear la sala");

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

  async function onJoinRoom() {
    setError("");
    const n = name.trim();
    const code = (joinCode || roomCode).trim().toUpperCase();

    if (!n) return setError("Escribe tu nombre.");
    if (!code) return setError("Escribe el código.");

    setBusy(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc("join_room", {
        p_code: code,
        p_player2_name: n,
      });
      if (rpcErr) throw rpcErr;

      const joined = data?.[0];
      if (!joined?.code) throw new Error("No se pudo unir a la sala");

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
      const { data, error: rpcErr } = await supabase.rpc("flip_coin", {
        p_code: roomCode,
      });
      if (rpcErr) throw rpcErr;

      // La inserción también llega por Realtime; esto es solo para respuesta inmediata
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
    setError("");
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

  const canFlip = !!room?.player2_name && room?.status === "ready";

  return (
    <div className="container">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h2 style={{ margin: 0 }}>Volados</h2>
            <small className="muted">v1 ultra simple</small>
          </div>

          {mode === "room" ? (
            <button className="danger" onClick={onLeave} disabled={busy}>
              Salir
            </button>
          ) : null}
        </div>

        <div className="spacer" />

        {error ? (
          <div className="card" style={{ borderColor: "#b91c1c" }}>
            <b>Error:</b> {error}
          </div>
        ) : null}

        {mode === "home" ? (
          <>
            <div className="col">
              <label>
                <small className="muted">Tu nombre</small>
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Enrique"
                maxLength={24}
              />
            </div>

            <div className="spacer" />

            <div className="row">
              <button className="primary" onClick={onCreateRoom} disabled={busy}>
                {busy ? "..." : "Crear sala"}
              </button>

              <div style={{ flex: 1 }} />

              <input
                style={{ maxWidth: 220 }}
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="Código (ej: A7K9Q)"
                maxLength={5}
              />
              <button onClick={onJoinRoom} disabled={busy}>
                {busy ? "..." : "Unirse"}
              </button>
            </div>

            <div className="spacer" />

            <small className="muted">
              Si te comparten un link con <b>?room=XXXXX</b>, abrirá la sala directo.
            </small>

            <div className="footer">
              {mpLink ? (
                <a href={mpLink} target="_blank" rel="noopener noreferrer">
                  ☕ Invítame un café
                </a>
              ) : (
                <small className="muted">☕ (Configura VITE_MP_LINK)</small>
              )}
            </div>
          </>
        ) : null}

        {mode === "room" ? (
          <>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="row" style={{ gap: 8 }}>
                <span className="badge">
                  Sala: <b>{roomCode || "—"}</b>
                </span>
                {room?.status ? (
                  <span className="badge">Estado: {room.status}</span>
                ) : (
                  <span className="badge">Estado: —</span>
                )}
              </div>

              <div className="row">
                <button onClick={copyInviteLink} disabled={!roomCode || busy}>
                  Copiar link
                </button>
              </div>
            </div>

            <div className="spacer" />

            <div className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div className="col" style={{ flex: 1 }}>
                  <small className="muted">Jugador 1</small>
                  <b>{room?.player1_name || "—"}</b>
                </div>

                <div className="col" style={{ flex: 1 }}>
                  <small className="muted">Jugador 2</small>
                  <b>{room?.player2_name || "Esperando..."}</b>
                </div>
              </div>

              <div className="spacer" />

              <div className="row">
                <button
                  className="primary"
                  onClick={onFlip}
                  disabled={busy || !canFlip}
                  title={!canFlip ? "Se requieren 2 jugadores" : "Lanzar moneda"}
                >
                  {busy ? "..." : "Lanzar moneda"}
                </button>

                <small className="muted">
                  {canFlip
                    ? "Listo."
                    : "Se requieren 2 jugadores para lanzar."}
                </small>
              </div>
            </div>

            <div className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <b>Historial (últimos 50)</b>
                <small className="muted">
                  {room?.created_at ? `Sala creada: ${formatTime(room.created_at)}` : ""}
                </small>
              </div>

              <div className="spacer" />

              {rounds?.length ? (
                <div className="col">
                  {rounds.map((r) => (
                    <div
                      key={r.id}
                      className="row"
                      style={{ justifyContent: "space-between" }}
                    >
                      <span>
                        Resultado:{" "}
                        <b style={{ textTransform: "uppercase" }}>{r.result}</b>
                      </span>
                      <small className="muted">{formatTime(r.created_at)}</small>
                    </div>
                  ))}
                </div>
              ) : (
                <small className="muted">Aún no hay lanzamientos.</small>
              )}
            </div>

            <div className="footer">
              {mpLink ? (
                <a href={mpLink} target="_blank" rel="noopener noreferrer">
                  ☕ Invítame un café
                </a>
              ) : (
                <small className="muted">☕ (Configura VITE_MP_LINK)</small>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
