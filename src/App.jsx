import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";

export default function App() {
  const [room, setRoom] = useState(null);
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);

  const queryParams = new URLSearchParams(window.location.search);
  const codeFromUrl = queryParams.get("room");

  useEffect(() => {
    if (codeFromUrl) {
      setRoomCode(codeFromUrl.toUpperCase());
    }
  }, []);

  async function createRoom() {
    setError("");
    const { data, error } = await supabase.rpc("create_room", {
      p_player1_name: name,
    });

    if (error) {
      setError(error.message);
      return;
    }

    window.location.href = `/?room=${data}`;
  }

  async function joinRoom() {
    setError("");

    const { error } = await supabase.rpc("join_room", {
      p_code: roomCode,
      p_player2_name: name,
    });

    if (error) {
      setError("No se pudo unir a la sala");
      return;
    }

    loadRoom();
  }

  async function loadRoom() {
    const { data, error } = await supabase.rpc("get_room", {
      p_code: roomCode,
    });

    if (!error && data.length > 0) {
      setRoom(data[0]);
      loadHistory();
    }
  }

  async function loadHistory() {
    const { data } = await supabase
      .from("rounds")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);

    setHistory(data || []);
  }

  async function onFlip() {
    setError("");

    const { data, error } = await supabase.rpc("flip_coin", {
      p_code: roomCode,
    });

    if (error) {
      setError(error.message);
      return;
    }

    loadHistory();
  }

  function handleShare() {
    const link = `${window.location.origin}/?room=${room.code}`;

    if (navigator.share) {
      navigator.share({
        title: "Volados",
        text: "Únete a mi sala",
        url: link,
      });
    } else {
      navigator.clipboard.writeText(link);
      alert("Enlace copiado");
    }
  }

  useEffect(() => {
    if (roomCode) {
      loadRoom();
    }
  }, [roomCode]);

  if (!room) {
    return (
      <div className="container">
        <h1>Volados</h1>

        {error && <p style={{ color: "red" }}>{error}</p>}

        <input
          placeholder="Tu nombre"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        {codeFromUrl ? (
          <button onClick={joinRoom}>Unirse</button>
        ) : (
          <>
            <button onClick={createRoom}>Crear sala</button>

            <input
              placeholder="Código"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
            />
            <button onClick={joinRoom}>Unirse</button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="container">
      <h1>Volados</h1>

      {error && <p style={{ color: "red" }}>{error}</p>}

      <p>Sala: {room.code}</p>
      <p>
        {room.player1_name} vs {room.player2_name}
      </p>

      <button onClick={handleShare}>Invitar</button>

      <button onClick={onFlip}>Lanzar moneda</button>

      <h3>Historial</h3>
      {history.map((r) => (
        <p key={r.id}>
          {r.result} - {new Date(r.created_at).toLocaleString()}
        </p>
      ))}

      <button onClick={() => (window.location.href = "/")}>Salir</button>
    </div>
  );
}
