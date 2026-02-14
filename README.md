# Volados v1 (ultra simple)

## Requisitos
- Supabase project activo
- Vercel (opcional) para deploy
- Variables de entorno

## 1) Configurar Supabase (SQL)
En Supabase > SQL Editor > New query:
Pega y ejecuta el archivo `supabase_schema.sql`.

## 2) Variables de entorno (Vite)
Crea un archivo `.env.local` (solo en local) con:

VITE_SUPABASE_URL="https://TU-PROYECTO.supabase.co"
VITE_SUPABASE_ANON_KEY="TU_ANON_KEY"
VITE_MP_LINK="https://link.mercadopago.com.mx/tu-link"

En Vercel, agrega las mismas variables en:
Project Settings -> Environment Variables

## 3) Correr local
npm i
npm run dev

## 4) Uso
- Crear sala: escribe nombre -> Crear
- Compartir: copia el link ?room=XXXXX
- Unirse: escribe nombre -> Unirse con código
- Lanzar moneda: Flip (solo funciona con 2 jugadores)
- Historial: se muestra dentro de la sala

Notas:
- Salas expiran (lógica) a 1 hora: las RPC rechazan salas viejas.
- No hay auth: es intencional para v1.
