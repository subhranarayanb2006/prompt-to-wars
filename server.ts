import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '4mb' }));

const MODEL_NAME = 'gemini-4-hydrogen';
const TTS_MODEL_NAME = 'gemini-3.8-flash-lite-tts';

const PRIORITY_INSTRUCTIONS: Record<string, string> = {
  BALANCED: 'Balance minimizing stranded passengers, eliminating FDTL cancellations, and reducing total delay minutes.',
  MINIMIZE_STRANDED: 'Prioritize minimizing total stranded passengers above all else.',
  ZERO_CANCELLATIONS: 'Prioritize eliminating flight cancellations and crew FDTL breaches first.',
  MINIMIZE_DELAY: 'Prioritize reducing total cumulative delay minutes across the network.',
  LOW_RESOURCE: 'Favor low-cost actions (standby crew swaps, connection holds, or single-action plans) that avoid deploying multiple spare airframes whenever possible.',
};

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function callWithRetry<T>(fn: () => Promise<T>, maxAttempts = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 600 * attempt));
      }
    }
  }
  throw lastError;
}

/**
 * POST /api/dispatcher/recommend
 * Receives exact deterministic baseline metrics & deterministically evaluated candidate plans.
 * Uses Gemini (gemini-4-hydrogen) strictly to explain the domino cascade and rank/recommend
 * from the verified candidate plans so EVERY number stated matches the app's deterministic engine.
 */
app.post('/api/dispatcher/recommend', async (req, res) => {
  try {
    const {
      disruption,
      secondaryDisruption = null,
      baselineSummary,
      keyAffectedFlights,
      brokenConnections,
      candidatePlans,
      priority = 'BALANCED',
      costWeights = null,
    } = req.body ?? {};

    if (!disruption || !baselineSummary || !Array.isArray(candidatePlans)) {
      res.status(400).json({ error: 'Missing required deterministic simulation payload.' });
      return;
    }

    if (candidatePlans.length === 0) {
      res.status(400).json({ error: 'No candidate recovery plans are available for this disruption.' });
      return;
    }

    const ai = getGeminiClient();

    const validPlanIds = candidatePlans.map((p: { planId: string }) => p.planId);
    const priorityDirective = PRIORITY_INSTRUCTIONS[priority] ?? PRIORITY_INSTRUCTIONS.BALANCED;

    const systemInstruction = `You are the Senior Airline Network Operations Dispatcher for Domino Sky, an Indian domestic airline operating 16 airports, 70 flights, and 16 aircraft.

DISPATCH PRIORITY OBJECTIVE: ${priorityDirective}

CRITICAL ACCURACY MANDATE:
1. All delay minutes, flight counts, crew FDTL breaches, stranded passenger counts, and INR financial disruption costs provided to you were computed by the airline's deterministic simulation engine.
2. You MUST NOT invent, estimate, round, or recalculate ANY number. Every single number you mention (delayed flights, cancelled flights, total delay minutes, stranded passengers, crew breaches, saved passengers, flight IDs, airport codes) MUST match the exact integers provided in the input JSON.
3. Select up to 3 distinct plans STRICTLY from the provided candidatePlans list using their exact "planId" strings. Rank them with #1 strictly serving the Dispatch Priority Objective above, followed by strong complementary alternatives.
4. Provide a crisp tradeOffComparison comparing Option #1 against Option #2 (and #3 if present) in plain operational terms, stating exact passenger, crew timeout, and resource trade-offs.
5. Write crisp, direct, human-readable airline operations prose (no markdown bolding, no code-style prefixes, no buzzwords). Keep each rationale to 2-3 clear sentences citing exact Before -> After numbers.`;

    const prompt = JSON.stringify(
      {
        priority,
        disruption,
        secondaryDisruption,
        costWeights,
        baselineSummary,
        keyAffectedFlights: (keyAffectedFlights ?? []).slice(0, 12),
        brokenConnections: (brokenConnections ?? []).slice(0, 10),
        candidatePlans: candidatePlans.map((p: Record<string, unknown>) => ({
          planId: p.planId,
          title: p.title,
          category: p.category,
          actions: p.actions,
          before: p.before,
          after: p.after,
          deltas: p.deltas,
          rescuedFlightIds: p.rescuedFlightIds,
          newlyCancelledFlightIds: p.newlyCancelledFlightIds,
        })),
      },
      null,
      2
    );

    const response = await callWithRetry(() =>
      ai.models.generateContent({
        model: MODEL_NAME,
        contents: `Analyze this deterministic disruption cascade and recommend the best recovery plans from candidatePlans:\n\n${prompt}`,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              executiveBriefing: {
                type: Type.STRING,
                description:
                  '2-sentence operational summary of the disruption impact citing exact baseline delayed flights, cancelled flights, total delay minutes, and stranded passengers.',
              },
              dominoMechanism: {
                type: Type.STRING,
                description:
                  '2-3 sentences explaining the exact chain reaction (which direct flights were held, how aircraft/crew cascades spread to clear-sky cities, and why any crew FDTL cancellations occurred).',
              },
              tradeOffComparison: {
                type: Type.STRING,
                description:
                  '2-3 sentences explaining in plain operational terms why Option #1 beats Option #2 (and #3), quoting exact differences in stranded passengers, prevented crew timeouts, delay minutes, and spare/resource commitment.',
              },
              recommendations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    planId: {
                      type: Type.STRING,
                      description: `Exact planId from candidatePlans: ${validPlanIds.join(', ')}`,
                    },
                    rank: {
                      type: Type.INTEGER,
                      description: '1, 2, or 3',
                    },
                    badge: {
                      type: Type.STRING,
                      description: 'Short plain label like Recommended Primary, Low-Resource Option, or Balanced Trade-off',
                    },
                    headline: {
                      type: Type.STRING,
                      description: 'Concise action headline under 12 words',
                    },
                    rationale: {
                      type: Type.STRING,
                      description:
                        '2-3 sentences explaining why this plan works, quoting exact Before -> After stranded passengers, cancellations, and total delay minutes.',
                    },
                    tradeOff: {
                      type: Type.STRING,
                      description:
                        '1 concise sentence stating operational cost or residual impact (e.g. spare utilization, remaining delayed flights, or passengers affected by a strategic cancellation).',
                    },
                    operationalSteps: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: 'Concrete dispatch checklist steps referencing exact flight IDs, aircraft/spares, or standby crews.',
                    },
                  },
                  required: ['planId', 'rank', 'badge', 'headline', 'rationale', 'tradeOff', 'operationalSteps'],
                },
              },
            },
            required: ['executiveBriefing', 'dominoMechanism', 'tradeOffComparison', 'recommendations'],
          },
        },
      })
    );

    const rawText = (response.text ?? '{}').trim();
    const parsed = JSON.parse(rawText);

    const validIdSet = new Set<string>(validPlanIds);
    const seen = new Set<string>();
    const filteredRecs = (parsed.recommendations ?? []).filter((r: { planId: string }) => {
      if (!r || !validIdSet.has(r.planId) || seen.has(r.planId)) return false;
      seen.add(r.planId);
      return true;
    });

    res.json({
      executiveBriefing: parsed.executiveBriefing ?? '',
      dominoMechanism: parsed.dominoMechanism ?? '',
      tradeOffComparison: parsed.tradeOffComparison ?? '',
      recommendations: filteredRecs.slice(0, 3),
      modelUsed: MODEL_NAME,
      priorityUsed: priority,
    });
  } catch (err: unknown) {
    console.error('AI Dispatcher /recommend error:', err);
    const message = err instanceof Error ? err.message : 'Failed to generate AI Dispatcher recommendations.';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/dispatcher/parse-scenario
 * Parses a natural-language disruption description into an exact deterministic DisruptionConfig
 * and optional DispatchPriority validated against the active airports list.
 */
app.post('/api/dispatcher/parse-scenario', async (req, res) => {
  try {
    const { prompt, airports } = req.body ?? {};
    if (!prompt || typeof prompt !== 'string' || !Array.isArray(airports)) {
      res.status(400).json({ error: 'Natural language prompt and airport list are required.' });
      return;
    }

    const ai = getGeminiClient();
    const validCodes = airports.map((a: { code: string }) => a.code);

    const response = await callWithRetry(() =>
      ai.models.generateContent({
        model: MODEL_NAME,
        contents: `Parse this airline disruption scenario into structured simulator parameters.\nUser request: "${prompt}"\nAvailable airports: ${JSON.stringify(airports)}`,
        config: {
          systemInstruction: `Convert natural-language airline disruption prompts into exact simulator inputs.
Rules:
- airportCode MUST be one of: ${validCodes.join(', ')}. Default to BOM if city is unclear.
- startMin and endMin are minutes from midnight (00:00). Operating day is 330 (05:30) to 1140 (19:00). Ensure endMin - startMin is between 30 and 240 minutes. Default startMin = 480 (08:00), duration = 90m if omitted.
- reason MUST be one of: "Thunderstorm", "Dense Fog", "Runway Closure", "ATC Ground Stop".
- priority MUST be one of: "BALANCED", "MINIMIZE_STRANDED", "ZERO_CANCELLATIONS", "MINIMIZE_DELAY", "LOW_RESOURCE".
- interpretation: 1 short crisp sentence confirming what will be simulated.`,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              airportCode: { type: Type.STRING },
              startMin: { type: Type.INTEGER },
              endMin: { type: Type.INTEGER },
              reason: { type: Type.STRING },
              priority: { type: Type.STRING },
              interpretation: { type: Type.STRING },
            },
            required: ['airportCode', 'startMin', 'endMin', 'reason', 'priority', 'interpretation'],
          },
        },
      })
    );

    const parsed = JSON.parse((response.text ?? '{}').trim());
    const validSet = new Set(validCodes);
    const airportCode = validSet.has(parsed.airportCode) ? parsed.airportCode : validCodes[0] ?? 'BOM';
    const startMin = Math.max(330, Math.min(1080, Math.round((Number(parsed.startMin) || 480) / 15) * 15));
    const rawDuration = (Number(parsed.endMin) || startMin + 90) - startMin;
    const clampedDuration = Math.max(30, Math.min(240, Math.round(rawDuration / 15) * 15));
    const endMin = Math.min(1200, startMin + clampedDuration);
    const allowedReasons = ['Thunderstorm', 'Dense Fog', 'Runway Closure', 'ATC Ground Stop'];
    const reason = allowedReasons.includes(parsed.reason) ? parsed.reason : 'Thunderstorm';
    const allowedPriorities = Object.keys(PRIORITY_INSTRUCTIONS);
    const priority = allowedPriorities.includes(parsed.priority) ? parsed.priority : 'BALANCED';

    res.json({
      airportCode,
      startMin,
      endMin,
      reason,
      priority,
      interpretation: parsed.interpretation || `Closing ${airportCode} due to ${reason.toLowerCase()}.`,
    });
  } catch (err: unknown) {
    console.error('AI Dispatcher /parse-scenario error:', err);
    const message = err instanceof Error ? err.message : 'Failed to parse disruption scenario.';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/dispatcher/comms
 * Generates deterministic-grounded Passenger Advisory (SMS + Gate PA), Crew Dispatch Directive,
 * and Executive OCC Situation Report matching live Before/After simulation numbers.
 */
app.post('/api/dispatcher/comms', async (req, res) => {
  try {
    const { snapshot } = req.body ?? {};
    if (!snapshot) {
      res.status(400).json({ error: 'Deterministic simulation snapshot is required.' });
      return;
    }

    const ai = getGeminiClient();

    const response = await callWithRetry(() =>
      ai.models.generateContent({
        model: MODEL_NAME,
        contents: `Generate airline operations communications strictly grounded in this live deterministic snapshot:\n${JSON.stringify(snapshot, null, 2)}`,
        config: {
          systemInstruction: `You are the Operations Communications Lead at Domino Sky Airline OCC.
Write crisp, realistic, empathetic, and operationally exact communications.
STRICT GROUNDING RULE: Every flight ID, route, time, aircraft registration, crew ID, and passenger count MUST match the provided JSON snapshot verbatim. Never invent numbers or flights. No markdown formatting or bullet asterisks.`,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              passengerAdvisory: {
                type: Type.OBJECT,
                properties: {
                  subject: { type: Type.STRING },
                  smsText: {
                    type: Type.STRING,
                    description: 'Concise 2-sentence SMS advisory citing affected hub, delay/recovery status, and passenger guidance.',
                  },
                  gateAnnouncement: {
                    type: Type.STRING,
                    description: 'Spoken terminal PA announcement (3-4 natural sentences, ready for TTS playback, citing exact airport, reason, and recovery action if applied).',
                  },
                },
                required: ['subject', 'smsText', 'gateAnnouncement'],
              },
              crewDirective: {
                type: Type.OBJECT,
                properties: {
                  subject: { type: Type.STRING },
                  directiveText: {
                    type: Type.STRING,
                    description: '3-4 concise operational sentences addressed to flight & cabin crews specifying FDTL legal duty alerts, standby reliefs, or spare aircraft assignments.',
                  },
                },
                required: ['subject', 'directiveText'],
              },
              executiveSitrep: {
                type: Type.OBJECT,
                properties: {
                  subject: { type: Type.STRING },
                  summaryText: {
                    type: Type.STRING,
                    description: '3-4 sentence OCC leadership SitRep quoting exact Before -> After delayed flights, cancelled flights, total delay minutes, and stranded passengers.',
                  },
                },
                required: ['subject', 'summaryText'],
              },
            },
            required: ['passengerAdvisory', 'crewDirective', 'executiveSitrep'],
          },
        },
      })
    );

    const parsed = JSON.parse((response.text ?? '{}').trim());
    res.json({
      ...parsed,
      modelUsed: MODEL_NAME,
    });
  } catch (err: unknown) {
    console.error('AI Dispatcher /comms error:', err);
    const message = err instanceof Error ? err.message : 'Failed to generate operational communications.';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/dispatcher/explain-flight
 * Produces a concise plain-English domino explanation and ready-to-speak gate notice for a single selected flight.
 */
app.post('/api/dispatcher/explain-flight', async (req, res) => {
  try {
    const { flightContext } = req.body ?? {};
    if (!flightContext) {
      res.status(400).json({ error: 'Flight deterministic context is required.' });
      return;
    }

    const ai = getGeminiClient();

    const response = await callWithRetry(() =>
      ai.models.generateContent({
        model: MODEL_NAME,
        contents: `Explain this specific flight's deterministic domino impact and draft a gate notice:\n${JSON.stringify(flightContext, null, 2)}`,
        config: {
          systemInstruction: `You are an Airline OCC Dispatcher explaining a single flight's delay or cancellation to a duty manager and gate agent.
Use ONLY the exact numbers, flight IDs, times, aircraft IDs, crew duty minutes, and passenger counts provided. Keep prose crisp and natural with zero markdown.`,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              plainEnglishSummary: {
                type: Type.STRING,
                description: '2 crisp sentences explaining the exact chain reaction from the closed airport to this flight.',
              },
              passengerGateNotice: {
                type: Type.STRING,
                description: '2-3 polite, clear spoken sentences a gate agent can read over the terminal PA for this exact flight.',
              },
              recommendedNextStep: {
                type: Type.STRING,
                description: '1 direct operational sentence recommending the best dispatch move for this flight based on availableActions.',
              },
            },
            required: ['plainEnglishSummary', 'passengerGateNotice', 'recommendedNextStep'],
          },
        },
      })
    );

    const parsed = JSON.parse((response.text ?? '{}').trim());
    res.json({
      ...parsed,
      modelUsed: MODEL_NAME,
    });
  } catch (err: unknown) {
    console.error('AI Dispatcher /explain-flight error:', err);
    const message = err instanceof Error ? err.message : 'Failed to explain flight cascade.';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/dispatcher/voice-briefing
 * Synthesizes spoken WAV audio using Gemini 3.8 Flash Lite TTS for OCC briefings & terminal gate announcements.
 */
app.post('/api/dispatcher/voice-briefing', async (req, res) => {
  try {
    const { text, style = 'Clear, calm, authoritative airline operations control dispatcher' } = req.body ?? {};
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      res.status(400).json({ error: 'Spoken text is required for voice briefing.' });
      return;
    }

    const ai = getGeminiClient();
    const safeText = text.trim().slice(0, 1200);

    const response = await callWithRetry(() =>
      ai.models.generateContent({
        model: TTS_MODEL_NAME,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: safeText,
                speechMetadata: {
                  style,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      })
    );

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      throw new Error('No audio payload was returned by the speech synthesis model.');
    }

    res.json({
      audioBase64: base64Audio,
      mimeType: 'audio/wav',
      modelUsed: TTS_MODEL_NAME,
    });
  } catch (err: unknown) {
    console.error('AI Dispatcher /voice-briefing error:', err);
    const message = err instanceof Error ? err.message : 'Failed to synthesize voice briefing.';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/dispatcher/ask
 * Answers a natural-language question from the operator strictly grounded in the current
 * deterministic simulation snapshot (baseline, active recovery actions, flights, crews, connections).
 */
app.post('/api/dispatcher/ask', async (req, res) => {
  try {
    const { question, context } = req.body ?? {};
    if (!question || typeof question !== 'string' || !context) {
      res.status(400).json({ error: 'Question and deterministic simulation context are required.' });
      return;
    }

    const ai = getGeminiClient();

    const systemInstruction = `You are the Senior Airline Network Operations Dispatcher for Domino Sky.
Answer the operator's question concisely (3-6 sentences or short structured bullet points) using ONLY the exact deterministic numbers, flight IDs, times, aircraft IDs, crew duty minutes, and passenger counts supplied in the JSON snapshot.
Never invent or alter any number. If a flight is on time or unaffected, state that plainly. Do not use markdown headers or hype.`;

    const response = await callWithRetry(() =>
      ai.models.generateContent({
        model: MODEL_NAME,
        contents: `Operator Question: ${question}\n\nLive Deterministic Network Snapshot:\n${JSON.stringify(context, null, 2)}`,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      })
    );

    res.json({
      answer: (response.text ?? '').trim(),
      modelUsed: MODEL_NAME,
    });
  } catch (err: unknown) {
    console.error('AI Dispatcher /ask error:', err);
    const message = err instanceof Error ? err.message : 'Failed to answer dispatcher query.';
    res.status(500).json({ error: message });
  }
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  const port = Number(process.env.PORT ?? 3000);

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req, res) => {
      const indexFile = path.join(distPath, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Domino Sky server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
