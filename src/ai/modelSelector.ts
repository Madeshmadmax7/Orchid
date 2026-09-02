// ============================================================================
// Orchid — Smart Model Selector
// ============================================================================
// Discovers available VS Code language models, classifies them into tiers,
// and selects the optimal model based on the user's task intent.
// ============================================================================

import * as vscode from 'vscode';
import { QueryIntent } from '../types';

/**
 * Model capability tiers — from most capable to lightest.
 */
export type ModelTier = 'heavy' | 'medium' | 'light';

/**
 * A discovered model with its computed tier.
 */
interface ClassifiedModel {
  model: vscode.LanguageModelChat;
  tier: ModelTier;
  /** Human-readable label for logging */
  label: string;
}

/**
 * Result returned by selectForTask.
 */
export interface ModelSelectionResult {
  model: vscode.LanguageModelChat;
  tier: ModelTier;
  label: string;
  /** Why this model was chosen */
  reason: string;
  /** All models that were discovered */
  allDiscovered: ClassifiedModel[];
}

// ── Tier classification patterns ────────────────────────────────────────────
// Each pattern maps a regex (tested against the model's family + name) to a tier.
// Order matters: first match wins. More specific patterns come first.

const TIER_PATTERNS: { pattern: RegExp; tier: ModelTier }[] = [
  // Heavy-tier models (most capable)
  { pattern: /o[134]-/i, tier: 'heavy' },           // o1-*, o3-*, o4-*
  { pattern: /gpt-4o(?!-mini)/i, tier: 'heavy' },   // gpt-4o but NOT gpt-4o-mini
  { pattern: /gpt-4(?!o)/i, tier: 'heavy' },         // gpt-4, gpt-4-turbo
  { pattern: /claude-3[\.\-]?5?-?sonnet/i, tier: 'heavy' },
  { pattern: /claude-3[\.\-]?opus/i, tier: 'heavy' },
  { pattern: /claude-4/i, tier: 'heavy' },
  { pattern: /gemini[\.\-]?1[\.\-]?5[\.\-]?pro/i, tier: 'heavy' },
  { pattern: /gemini[\.\-]?2/i, tier: 'heavy' },

  // Medium-tier models
  { pattern: /gpt-4o-mini/i, tier: 'medium' },
  { pattern: /claude-3[\.\-]?5?-?haiku/i, tier: 'medium' },
  { pattern: /claude-3[\.\-]?haiku/i, tier: 'medium' },
  { pattern: /gemini[\.\-]?1[\.\-]?5[\.\-]?flash/i, tier: 'medium' },
  { pattern: /gemini[\.\-]?flash/i, tier: 'medium' },
  { pattern: /gpt-3[\.\-]?5/i, tier: 'medium' },

  // Everything else falls to light
];

// ── Embedding / non-chat model blocklist ────────────────────────────────────
const BLOCKLIST_PATTERNS: RegExp[] = [
  /embed/i,
  /ada/i,
  /whisper/i,
  /dall-e/i,
  /tts/i,
  /text-moderation/i,
  /completion(?!.*chat)/i, // text-completion but not chat-completion
];

/**
 * Maps a QueryIntent to the preferred model tier.
 */
function intentToPreferredTier(intent: QueryIntent, rawQuery: string): ModelTier {
  switch (intent) {
    // Heavy — code generation, complex reasoning
    case 'MODIFICATION':
    case 'TRACE':
    case 'ERROR_VALIDATION':
      return 'heavy';

    // Medium — detailed but read-only analysis
    case 'EXPLAIN':
    case 'DEPENDENCIES':
    case 'DEPENDENTS':
    case 'USAGE':
      return 'medium';

    // Light — simple lookups
    case 'CALLERS':
      return 'light';

    // GENERAL — check if the user is requesting code generation
    case 'GENERAL':
    default: {
      const lower = rawQuery.toLowerCase();
      const codeGenKeywords = /\b(add|create|implement|write|build|generate|refactor|rename|delete|remove|update|change|fix|modify)\b/;
      if (codeGenKeywords.test(lower)) {
        return 'heavy';
      }
      return 'light';
    }
  }
}

export class ModelSelector {
  /**
   * Discovers all available models, classifies them, and picks the best one
   * for the given task intent.
   */
  static async selectForTask(
    intent: QueryIntent,
    rawQuery: string,
    outputChannel: vscode.OutputChannel
  ): Promise<ModelSelectionResult | null> {
    // 1. Discover ALL available models
    const allModels = await vscode.lm.selectChatModels({});

    if (allModels.length === 0) {
      outputChannel.appendLine('[ModelSelector] No language models available.');
      return null;
    }

    // 2. Filter out non-chat models (embeddings, TTS, etc.)
    const chatModels = allModels.filter(m => {
      const identifier = `${m.family || ''} ${m.name || ''} ${m.id || ''}`.toLowerCase();
      return !BLOCKLIST_PATTERNS.some(p => p.test(identifier));
    });

    if (chatModels.length === 0) {
      outputChannel.appendLine('[ModelSelector] All discovered models are non-chat. Falling back to first available.');
      const fallback = allModels[0];
      return {
        model: fallback,
        tier: 'light',
        label: `${fallback.vendor}/${fallback.family} (${fallback.name || fallback.id})`,
        reason: 'Only non-chat models available; using first model as fallback',
        allDiscovered: []
      };
    }

    // 3. Classify each model into a tier
    const classified: ClassifiedModel[] = chatModels.map(m => {
      const identifier = `${m.family || ''} ${m.name || ''} ${m.id || ''}`;
      let tier: ModelTier = 'light'; // default

      for (const { pattern, tier: t } of TIER_PATTERNS) {
        if (pattern.test(identifier)) {
          tier = t;
          break;
        }
      }

      return {
        model: m,
        tier,
        label: `${m.vendor}/${m.family} (${m.name || m.id})`
      };
    });

    // 4. Log all discovered models
    outputChannel.appendLine(`\n[ModelSelector] Discovered ${classified.length} chat model(s):`);
    for (const c of classified) {
      outputChannel.appendLine(`  • [${c.tier.toUpperCase()}] ${c.label} — maxInput: ${c.model.maxInputTokens}`);
    }

    // 5. Determine preferred tier from intent
    const preferredTier = intentToPreferredTier(intent, rawQuery);

    // 6. Select model: try preferred tier first, then fall down
    const tierOrder: ModelTier[] =
      preferredTier === 'heavy'  ? ['heavy', 'medium', 'light'] :
      preferredTier === 'medium' ? ['medium', 'heavy', 'light'] :
                                   ['light', 'medium', 'heavy'];

    let selected: ClassifiedModel | undefined;
    let selectedFromTier: ModelTier | undefined;

    for (const tier of tierOrder) {
      const candidates = classified.filter(c => c.tier === tier);
      if (candidates.length > 0) {
        // Within a tier, prefer models with higher maxInputTokens (more capable)
        candidates.sort((a, b) => (b.model.maxInputTokens || 0) - (a.model.maxInputTokens || 0));
        selected = candidates[0];
        selectedFromTier = tier;
        break;
      }
    }

    // Should never happen since chatModels.length > 0, but just in case
    if (!selected) {
      selected = classified[0];
      selectedFromTier = classified[0].tier;
    }

    const wasDowngraded = selectedFromTier !== preferredTier;
    const reason = wasDowngraded
      ? `Intent "${intent}" prefers ${preferredTier} tier, but no ${preferredTier} models available. Fell to ${selectedFromTier} tier.`
      : `Intent "${intent}" → ${preferredTier} tier → ${selected.label}`;

    outputChannel.appendLine(`[ModelSelector] ${reason}`);

    return {
      model: selected.model,
      tier: selected.tier,
      label: selected.label,
      reason,
      allDiscovered: classified
    };
  }
}
