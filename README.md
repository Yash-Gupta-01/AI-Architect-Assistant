# AI Architect Assistant

Conversational floor-plan assistant with three phases:

- intake
- feasibility validation
- image generation

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create your local env file:

```bash
copy .env.example .env
```

3. Fill in credentials in `.env`.

## Environment Variables

### Text model provider

- `AI_TEXT_PROVIDER`: optional explicit override (`openrouter`, `openai`, or `gemini`).
- If `AI_TEXT_PROVIDER` is blank, provider auto-selection is:
	1. `OPENROUTER_API_KEY`
	2. `GEMINI_API_KEY`
	3. `OPENAI_API_KEY`
- `OPENROUTER_TEXT_MODEL`: defaults to `nvidia/nemotron-3-super-120b-a12b:free`.
- `OPENAI_TEXT_MODEL`: defaults to `gpt-4o`.
- `GEMINI_TEXT_MODEL`: defaults to `gemini-2.0-flash`.

### Credentials

- `OPENROUTER_API_KEY`: required when `AI_TEXT_PROVIDER=openrouter`.
- `OPENAI_API_KEY`: required when using OpenAI for text or image generation.
- `GEMINI_API_KEY`: required only when `AI_TEXT_PROVIDER=gemini`.

### Image provider

- `IMAGE_PROVIDER`: optional explicit override (`google`, `openrouter`, or `openai`).
- If `IMAGE_PROVIDER` is blank, provider auto-selection is:
	1. `GOOGLE_IMAGE_API_KEY` (or `GEMINI_API_KEY`)
	2. `OPENROUTER_API_KEY`
	3. `OPENAI_API_KEY`
- `GOOGLE_IMAGE_MODEL`: defaults to `imagen-4.0-ultra-generate-001`.
- `OPENROUTER_IMAGE_MODEL`: defaults to `openai/dall-e-3`.
- `OPENAI_IMAGE_MODEL`: defaults to `dall-e-3`.

### App limits

- `NEXT_PUBLIC_MAX_PLOT_AREA_M2`: optional, defaults to `500`.

## Important Notes

- Text chat supports OpenRouter models, Gemini API, and OpenAI through `/api/chat`.
- When OpenRouter is selected, default text model is `nvidia/nemotron-3-super-120b-a12b:free`.
- Image generation also auto-selects by available API key in `/api/generate-plan`.
- Default image model is Google Imagen 4 Ultra Generate (`imagen-4.0-ultra-generate-001`) when Google credentials are present.
- If you want a specific image model/provider, set `IMAGE_PROVIDER` and the matching model env var.

## Run

```bash
npm run dev
```

Open http://localhost:3000.

## Validate

```bash
npm run build
```
