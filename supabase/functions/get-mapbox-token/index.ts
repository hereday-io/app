// Returns the public Mapbox token to the browser. Wildcard CORS on purpose:
// every map viewer's browser receives this token anyway.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { publicCors } from "../_shared/http.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: publicCors });
  }

  const token = Deno.env.get("MAPBOX_TOKEN");
  if (!token) {
    return new Response(JSON.stringify({ error: "MAPBOX_TOKEN not configured" }), {
      status: 500,
      headers: { ...publicCors, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ token }), {
    headers: { ...publicCors, "Content-Type": "application/json" },
  });
});
