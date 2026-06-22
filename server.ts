// =========================================================================
// Title: Full-stack Express Server with Vite and Gemini API Integration
// Description: Manages the runtime server environment, resolves static files,
//              provides routes to read Verilog workspace sources, and proxies
//              requests to Gemini 3.5 Flash for the VLSI Hardware Mentor.
// =========================================================================

import express, { Request, Response } from "express";
import path from "path";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware for parsing JSON requests
  app.use(express.json());

  // Shared Gemini client setup
  const apiKey = process.env.GEMINI_API_KEY;
  let ai: GoogleGenAI | null = null;
  if (apiKey) {
    ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  } else {
    console.warn("GEMINI_API_KEY is not defined in the environment. AI features will fallback to offline help.");
  }

  // 1. API: Read Verilog Source Files dynamically from the workspace
  app.get("/api/verilog", (req: Request, res: Response) => {
    const fileParam = req.query.file as string;
    const allowedFiles: Record<string, string> = {
      tlb: "tlb.v",
      ptw: "ptw.v",
      mmu: "mmu.v",
      tb: "mmu_tb.v",
      ys: "yosys_synth.ys",
    };

    if (!fileParam || !allowedFiles[fileParam]) {
      res.status(400).json({ error: "Invalid or missing 'file' parameter. Options: tlb, ptw, mmu, tb, ys." });
      return;
    }

    const filename = allowedFiles[fileParam];
    const filePath = path.join(process.cwd(), "src", "verilog", filename);

    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        res.json({ filename, content });
      } else {
        res.status(404).json({ error: `File ${filename} not found in workspace.` });
      }
    } catch (err: any) {
      res.status(500).json({ error: `Failed to read file: ${err.message}` });
    }
  });

  // 2. API: Chat Route proxying to Gemini 3.5 Flash
  app.post("/api/chat", async (req: Request, res: Response) => {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: "Required array parameter 'messages' is missing or invalid." });
      return;
    }

    // Offline mode defense
    if (!ai) {
      res.json({
        text: "Offline Mode: No Gemini API Key was found in your AI Studio secrets vault. I am a simulated VLSI Architecture assistant. The MMU is designed in Verilog with 32-bit Virtual-to-Physical page table walk translation. Please configure your GEMINI_API_KEY secret to enable the active AI tutor chat!",
      });
      return;
    }

    try {
      // System instructions setup for the VLSI Hardware Mentor
      const systemInstruction = `You are an expert VLSI Design Engineer, Verilog RTL Specialist, and Digital System Architect.
Your role is to act as a supportive, authoritative Computer Architecture Mentor for a student building a course project: "Memory Management Unit (MMU) Design using Verilog HDL".
The project features:
- 32-bit Virtual Address input translating to 32-bit Physical Address
- 4 KB Page Frame alignments (Offset = 12 bits, VPN = 20 bits)
- 2-way Set-Associative TLB (4 sets, 8 entries) with pseudo-LRU replacement and ASID (Address-Space ID) registers.
- Hardware 2-Level Page Table Walker (PTW) executing SV32-equivalent page traversals from a main memory bus.
- Page Fault diagnostics (missing translations) and Protection Fault diagnostics (R/W/X permission and privilege User/Supervisor violations).
- Yosys synthesis script.

Respond to student questions with technical accuracy, concise code snippets when asked, and clear explanations of paging, caching, and hardware protocols. Keep your tone professional, encouraging, and highly educational.`;

      // Structure messages for @google/genai
      // Convert messages parameter to Gemini structure
      const formattedContents = messages.map((m: any) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

      const modelsToTry = [
        "gemini-3.5-flash",
        "gemini-flash-latest",
        "gemini-3.1-flash-lite",
        "gemini-2.5-flash",
        "gemini-3.1-pro-preview",
      ];

      let lastError: any = null;
      let responseText: string | undefined = undefined;

      for (const modelName of modelsToTry) {
        let skipModel = false;
        // Try up to 3 attempts with exponential backoff for transient/503 errors
        for (let attempt = 0; attempt < 3; attempt++) {
          if (skipModel) break;
          try {
            console.log(`[Gemini API] Querying model=${modelName} (attempt=${attempt + 1}/3)...`);
            const response = await ai.models.generateContent({
              model: modelName,
              contents: formattedContents,
              config: {
                systemInstruction: systemInstruction,
                temperature: 0.7,
              },
            });

            if (response && response.text) {
              responseText = response.text;
              console.log(`[Gemini API] Successfully generated content using model=${modelName}`);
              break;
            }
          } catch (e: any) {
            lastError = e;
            const errMsg = e.message || String(e);
            console.error(`[Gemini API] Error with model=${modelName} (attempt=${attempt + 1}):`, errMsg);

            // Check if model is totally unsupported or doesn't exist
            const isNotFoundError = 
              e.status === 404 || 
              e.code === 404 || 
              errMsg.toLowerCase().includes("not found") || 
              errMsg.toLowerCase().includes("not supported") ||
              errMsg.toLowerCase().includes("unsupported");

            if (isNotFoundError) {
              console.warn(`[Gemini API] Model=${modelName} is not supported or not found. Skipping remaining attempts.`);
              skipModel = true;
              break;
            }

            // Exponential backoff for 503 or transient errors
            if (attempt < 2) {
              const backoffDelay = (attempt + 1) * 1000; // 1000ms, then 2000ms
              console.log(`[Gemini API] Retrying in ${backoffDelay}ms...`);
              await new Promise((resolve) => setTimeout(resolve, backoffDelay));
            }
          }
        }
        if (responseText) {
          break;
        }
      }

      if (responseText) {
        res.json({ text: responseText });
      } else {
        throw lastError || new Error("All candidate Gemini models failed to generate content.");
      }
    } catch (err: any) {
      console.error("Gemini API Error:", err);
      res.status(500).json({ error: `Gemini API transaction failed: ${err.message}` });
    }
  });

  // 3. Vite development middleware setup OR static production files serving
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting server in DEVELOPMENT mode...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting server in PRODUCTION mode...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    // SPA routing fallback: send index.html for all client-side routes
    app.get("*", (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Express custom server started and listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start full-stack server:", err);
});
