import fetch from "node-fetch";
import { GoogleAuth } from "google-auth-library";
import { checkFeasibility } from "@/lib/feasibility-checker";
import { compileFloorPlanPrompt } from "@/lib/prompt-compiler";
import type { FloorPlanSpec } from "@/lib/types";

export const runtime = "nodejs";

type ImageProviderName = "google" | "nvidia";

const imageProviderPriority: ImageProviderName[] = ["google", "nvidia"];

/** How long a failed image provider is deprioritised before being retried (ms). */
const IMAGE_PROVIDER_FAILURE_TTL_MS = 5 * 60 * 1000;
const imageProviderFailedAt = new Map<ImageProviderName, number>();

function markImageProviderFailed(provider: ImageProviderName) {
  imageProviderFailedAt.set(provider, Date.now());
}

function clearImageProviderFailure(provider: ImageProviderName) {
  imageProviderFailedAt.delete(provider);
}

function isImageProviderFailed(provider: ImageProviderName): boolean {
  const ts = imageProviderFailedAt.get(provider);
  if (!ts) return false;
  if (Date.now() - ts > IMAGE_PROVIDER_FAILURE_TTL_MS) {
    imageProviderFailedAt.delete(provider);
    return false;
  }
  return true;
}

type GeneratePlanRequest = {
  spec: FloorPlanSpec;
};

function getAvailableImageProviders(): ImageProviderName[] {
  const available: ImageProviderName[] = [];

  if (process.env.NVIDIA_API_KEY) {
    available.push("nvidia");
  }

  if (process.env.VERTEX_PROJECT_ID) {
    available.push("google");
  }

  return available;
}

function getImageProviderOrder(): ImageProviderName[] {
  const available = getAvailableImageProviders();
  const explicit = process.env.IMAGE_PROVIDER?.trim().toLowerCase();
  let preferred: ImageProviderName | undefined;

  if (explicit === "google" || explicit === "nvidia") {
    preferred = explicit;
  }

  const ordered: ImageProviderName[] = [];

  if (preferred && available.includes(preferred)) {
    ordered.push(preferred);
  }

  for (const provider of imageProviderPriority) {
    if (available.includes(provider) && !ordered.includes(provider)) {
      ordered.push(provider);
    }
  }

  if (ordered.length > 0) {
    // Move recently-failed providers to the end so healthy ones are tried first.
    const healthy = ordered.filter((p) => !isImageProviderFailed(p));
    const degraded = ordered.filter((p) => isImageProviderFailed(p));
    return [...healthy, ...degraded];
  }

  throw new Error(
    "No image API key found. Set NVIDIA_API_KEY or GOOGLE_IMAGE_API_KEY (or GEMINI_API_KEY).",
  );
}

async function generateWithGoogleImagen(prompt: string): Promise<string> {
  const projectId = process.env.VERTEX_PROJECT_ID;
  if (!projectId) {
    throw new Error("Missing VERTEX_PROJECT_ID for Vertex AI image provider.");
  }

  const model = process.env.GOOGLE_IMAGE_MODEL ?? "imagen-4.0-generate-001";
  const location = process.env.VERTEX_LOCATION ?? "us-central1";
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;

  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const accessToken = await auth.getAccessToken();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1 },
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Google Imagen generation failed: ${response.status} ${errBody}`);
  }

  const data = (await response.json()) as {
    predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
  };

  const prediction = data.predictions?.[0];
  if (!prediction?.bytesBase64Encoded) {
    throw new Error("Google Imagen returned no image data.");
  }

  return `data:${prediction.mimeType ?? "image/png"};base64,${prediction.bytesBase64Encoded}`;
}

async function generateWithNvidia(prompt: string): Promise<string> {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    throw new Error("Missing NVIDIA_API_KEY for NVIDIA image provider.");
  }

  const model = process.env.NVIDIA_IMAGE_MODEL ?? "black-forest-labs/flux.2-klein-4b";
  const invokeUrl = `https://ai.api.nvidia.com/v1/genai/${model}`;

  const response = await fetch(invokeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "Accept": "application/json",
    },
    body: JSON.stringify({
      prompt,
      width: 1024,
      height: 1024,
      seed: 0,
      steps: 4,
    }),
  });

  if (response.status !== 200) {
    const errBody = await response.text();
    throw new Error(`NVIDIA image generation failed: ${response.status} ${errBody}`);
  }

  const data = (await response.json()) as {
    artifacts?: Array<{ base64: string; mimeType?: string }>;
  };

  const artifact = data.artifacts?.[0];
  if (!artifact?.base64) {
    throw new Error("NVIDIA returned no image data.");
  }

  return `data:${artifact.mimeType ?? "image/png"};base64,${artifact.base64}`;
}

async function generateImageWithProvider(provider: ImageProviderName, prompt: string) {
  if (provider === "nvidia") {
    return generateWithNvidia(prompt);
  }
  return generateWithGoogleImagen(prompt);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GeneratePlanRequest;
    if (!body?.spec) {
      return Response.json(
        { error: "Invalid request. Expected a floor plan spec." },
        { status: 400 },
      );
    }

    const maxPlotArea = Number(process.env.NEXT_PUBLIC_MAX_PLOT_AREA_M2 ?? "500");
    const plotArea = body.spec.plot_width_m * body.spec.plot_length_m;

    if (plotArea > maxPlotArea) {
      return Response.json(
        {
          error: `Plot area ${plotArea.toFixed(2)}m2 exceeds maximum ${maxPlotArea}m2 for v1.`,
          issues: ["Reduce plot dimensions or raise NEXT_PUBLIC_MAX_PLOT_AREA_M2."],
        },
        { status: 422 },
      );
    }

    const feasibility = checkFeasibility(body.spec);
    if (!feasibility.feasible) {
      return Response.json(
        {
          error: "Floor plan is infeasible.",
          issues: feasibility.issues,
        },
        { status: 422 },
      );
    }

    const prompt = compileFloorPlanPrompt(body.spec);
    const providers = getImageProviderOrder();
    const failures: string[] = [];
    let imageUrl: string | undefined;
    let imageProvider: ImageProviderName | undefined;

    console.log(
      "[generate-plan] Starting image generation | PromptLength=%d chars | ProvidersAvailable=%s",
      prompt.length,
      providers.join(","),
    );

    for (const provider of providers) {
      try {
        imageUrl = await generateImageWithProvider(provider, prompt);
        imageProvider = provider;
        clearImageProviderFailure(provider);
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${provider}: ${message}`);
        markImageProviderFailed(provider);
        console.warn(`[generate-plan] ${provider} failed (will deprioritise for ${IMAGE_PROVIDER_FAILURE_TTL_MS / 60000} min), trying next provider:`, message);
      }
    }

    if (!imageUrl || !imageProvider) {
      throw new Error(`All image providers failed. ${failures.join(" | ")}`);
    }

    const googleImageModel = process.env.GOOGLE_IMAGE_MODEL ?? "imagen-4.0-generate-001";
    const nvidiaImageModel = process.env.NVIDIA_IMAGE_MODEL ?? "black-forest-labs/flux.2-klein-4b";
    const activeModel = imageProvider === "google" ? googleImageModel : nvidiaImageModel;

    console.log(
      "[generate-plan] ✓ Success | ImageProvider=%s ImageModel=%s PromptLength=%d chars",
      imageProvider,
      activeModel,
      prompt.length,
    );

    return Response.json({
      imageUrl,
      textSpec: body.spec,
      promptUsed: prompt,
      imageProvider,
    });
  } catch (error) {
    console.error("[generate-plan] image generation failed", error);

    const message =
      error instanceof Error
        ? error.message
        : "Unexpected error while generating floor plan image.";

    return Response.json(
      { error: message },
      { status: 500 },
    );
  }
}
