import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";

const app = express();

const PORT = process.env.PORT || 3000;
const MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
const MAX_HISTORY_MESSAGES = 12;

// Verificação de Segurança
if (!process.env.GEMINI_API_KEY) {
  console.error("Erro: defina GEMINI_API_KEY no arquivo .env");
  process.exit(1);
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const rootDir = process.cwd();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(rootDir, "public")));

let history = [];

/**
 * FUNÇÃO: Lê as instruções de comportamento do agente
 * O arquivo agente.txt deve estar dentro da pasta /context
 */
function readAgentPersona() {
  const agentPath = path.join(rootDir, "context", "agente.txt");
  
  if (fs.existsSync(agentPath)) {
    return fs.readFileSync(agentPath, "utf-8");
  }
  
  // Fallback caso o arquivo não exista
  return "Você é um assistente prestativo.";
}

/**
 * FUNÇÃO: Lê a base de conhecimento (arquivos TXT de contexto)
 */
function readTxtContext() {
  const contextDir = path.join(rootDir, "context");

  if (!fs.existsSync(contextDir)) {
    return "";
  }

  const files = fs
    .readdirSync(contextDir)
    .filter((file) => 
      file.toLowerCase().endsWith(".txt") && file.toLowerCase() !== "agente.txt"
    );

  const contents = files.map((file) => {
    const filePath = path.join(contextDir, file);
    const text = fs.readFileSync(filePath, "utf-8");

    return `--- INÍCIO DO ARQUIVO: ${file} ---\n${text}\n--- FIM DO ARQUIVO: ${file} ---`;
  });

  return contents.join("\n\n");
}

/**
 * FUNÇÃO: Monta o prompt estruturado para o RAG
 */
function buildUserPrompt(userMessage, contextText) {
  return `
CONTEXTO DE CONHECIMENTO DISPONÍVEL:
${contextText || "Nenhum material de apoio encontrado."}

PERGUNTA DO USUÁRIO:
${userMessage}

IMPORTANTE:
- Use APENAS o contexto fornecido para responder fatos.
- Se a resposta não estiver no material, informe educadamente.
`;
}

// ROTA PRINCIPAL: Chat com Agente + Contexto
app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Mensagem inválida." });
    }

    // 1. Recupera o "Cérebro" (Contexto) e a "Personalidade" (Agente)
    const contextText = readTxtContext();
    const agentPersona = readAgentPersona();

    // 2. Define a System Instruction vinda do agente.txt
    const systemInstruction = `
PERSONALIDADE E REGRAS:
${agentPersona}

INSTRUÇÕES ADICIONAIS:
- Responda sempre em Português Brasileiro.
- Seja fiel ao contexto fornecido.
`;

    const contents = [
      ...history,
      {
        role: "user",
        parts: [{ text: buildUserPrompt(message, contextText) }],
      },
    ];

    const response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        systemInstruction,
      },
    });

    const answer = response.text || "Não consegui gerar uma resposta.";

    // Atualiza o histórico
    history.push({ role: "user", parts: [{ text: message }] });
    history.push({ role: "model", parts: [{ text: answer }] });
    history = history.slice(-MAX_HISTORY_MESSAGES);

    return res.json({ answer });

  } catch (error) {
    console.error("Erro na API Gemini:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
});

// ROTA: Reset de Memória
app.post("/api/reset", (req, res) => {
  history = [];
  return res.json({ message: "Histórico apagado." });
});

app.listen(PORT, () => {
  console.log(`🚀 Sr. RAG online na porta ${PORT}`);
  console.log(`Acesse: http://localhost:${PORT}`);
});
