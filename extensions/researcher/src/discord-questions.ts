// ---------------------------------------------------------------------------
// Discord Researcher Questions Handler
// ---------------------------------------------------------------------------
//
// Sends interview questions as Discord embeds with buttons for answering.
// Similar to exec-approvals.ts but for researcher interview flow.

import type { ButtonInteraction, ComponentData } from "@buape/carbon";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { ButtonStyle, Routes } from "discord-api-types/v10";
import {
  type EventFrame,
  GatewayClient,
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES,
  createDiscordClient,
  logDebug,
  logError,
} from "openclaw/extension-bridge";

const RESEARCHER_KEY = "researchq";

export type ResearcherQuestionsEvent = {
  researchId: string;
  goal: string;
  questions: string[];
  options: Array<Array<string>>; // parsed options per question
  timeoutMs: number;
  notify: {
    channel: string;
    to: string;
    accountId?: string;
  };
};

export type ResearcherAnswerEvent = {
  researchId: string;
  answers: string[];
  answeredBy?: string;
};

function encodeCustomIdValue(value: string): string {
  return encodeURIComponent(value);
}

function decodeCustomIdValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function buildResearcherQuestionCustomId(
  researchId: string,
  questionIndex: number,
  optionIndex: number,
): string {
  return [
    `${RESEARCHER_KEY}:id=${encodeCustomIdValue(researchId)}`,
    `q=${questionIndex}`,
    `o=${optionIndex}`,
  ].join(";");
}

export function buildResearcherSubmitCustomId(researchId: string): string {
  return `${RESEARCHER_KEY}:id=${encodeCustomIdValue(researchId)};submit=1`;
}

export function buildResearcherSkipCustomId(researchId: string): string {
  return `${RESEARCHER_KEY}:id=${encodeCustomIdValue(researchId)};skip=1`;
}

export function parseResearcherQuestionData(data: ComponentData): {
  researchId: string;
  questionIndex?: number;
  optionIndex?: number;
  submit?: boolean;
  skip?: boolean;
} | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const coerce = (value: unknown) =>
    typeof value === "string" || typeof value === "number" ? String(value) : "";
  const rawId = coerce(data.id);
  if (!rawId) {
    return null;
  }

  const result: {
    researchId: string;
    questionIndex?: number;
    optionIndex?: number;
    submit?: boolean;
    skip?: boolean;
  } = {
    researchId: decodeCustomIdValue(rawId),
  };

  if (data.submit === "1" || data.submit === 1) {
    result.submit = true;
  }
  if (data.skip === "1" || data.skip === 1) {
    result.skip = true;
  }
  if (data.q !== undefined) {
    result.questionIndex = typeof data.q === "number" ? data.q : parseInt(String(data.q), 10);
  }
  if (data.o !== undefined) {
    result.optionIndex = typeof data.o === "number" ? data.o : parseInt(String(data.o), 10);
  }

  return result;
}

// Parse options from question text like "... — (options: \"a\", \"b\", \"c\")"
function parseQuestionOptions(question: string): { cleanQuestion: string; options: string[] } {
  const optionsMatch = question.match(/\s*—?\s*\(options?:\s*(.+?)\)\s*$/i);
  if (!optionsMatch) {
    return { cleanQuestion: question, options: [] };
  }

  const cleanQuestion = question.slice(0, question.indexOf(optionsMatch[0])).trim();
  const optionsStr = optionsMatch[1];

  // Parse quoted options: "option1", "option2", etc.
  const options: string[] = [];
  const regex = /"([^"]+)"/g;
  let match;
  while ((match = regex.exec(optionsStr)) !== null) {
    options.push(match[1]);
  }

  // Fallback: split by comma if no quoted options found
  if (options.length === 0) {
    options.push(...optionsStr.split(/,\s*/).map((s) => s.trim().replace(/^["']|["']$/g, "")));
  }

  return { cleanQuestion, options };
}

function formatQuestionsEmbed(
  event: ResearcherQuestionsEvent,
  selectedAnswers?: Map<number, string>,
) {
  const fields: Array<{ name: string; value: string; inline: boolean }> = [];

  for (let i = 0; i < event.questions.length; i++) {
    const { cleanQuestion, options } = parseQuestionOptions(event.questions[i]);
    const selected = selectedAnswers?.get(i);

    let value = cleanQuestion;
    if (options.length > 0) {
      value +=
        "\n" +
        options
          .map((opt, j) => {
            const marker = selected === opt ? "✅" : `${j + 1}.`;
            return `${marker} ${opt}`;
          })
          .join("\n");
    }
    if (selected && !options.includes(selected)) {
      value += `\n✅ ${selected}`;
    }

    fields.push({
      name: `Question ${i + 1}`,
      value: value.length > 1024 ? value.slice(0, 1021) + "..." : value,
      inline: false,
    });
  }

  const answeredCount = selectedAnswers?.size ?? 0;
  const description =
    answeredCount > 0
      ? `${answeredCount}/${event.questions.length} questions answered. Click options or "Submit" when ready.`
      : "Click the buttons below to answer each question.";

  return {
    title: "Research Interview",
    description,
    color: 0x5865f2, // Discord blurple
    fields,
    footer: { text: `Research ID: ${event.researchId}` },
    timestamp: new Date().toISOString(),
  };
}

function formatCompletedEmbed(
  event: ResearcherQuestionsEvent,
  answers: string[],
  answeredBy?: string,
) {
  const fields: Array<{ name: string; value: string; inline: boolean }> = [];

  for (let i = 0; i < event.questions.length; i++) {
    const { cleanQuestion } = parseQuestionOptions(event.questions[i]);
    const answer = answers[i] || "(no answer)";

    fields.push({
      name: `Q${i + 1}: ${cleanQuestion.slice(0, 200)}`,
      value: `✅ ${answer}`,
      inline: false,
    });
  }

  return {
    title: "Research Interview: Completed",
    description: answeredBy ? `Answered by ${answeredBy}` : "Answers submitted",
    color: 0x57f287, // Green
    fields,
    footer: { text: `Research ID: ${event.researchId}` },
    timestamp: new Date().toISOString(),
  };
}

function formatSkippedEmbed(event: ResearcherQuestionsEvent) {
  return {
    title: "Research Interview: Skipped",
    description: "User chose to skip the interview. Default values will be used.",
    color: 0xfee75c, // Yellow
    fields: [
      {
        name: "Goal",
        value: event.goal.slice(0, 500),
        inline: false,
      },
    ],
    footer: { text: `Research ID: ${event.researchId}` },
    timestamp: new Date().toISOString(),
  };
}

function formatExpiredEmbed(event: ResearcherQuestionsEvent) {
  return {
    title: "Research Interview: Expired",
    description: "This interview has timed out.",
    color: 0x99aab5, // Gray
    fields: [
      {
        name: "Goal",
        value: event.goal.slice(0, 500),
        inline: false,
      },
    ],
    footer: { text: `Research ID: ${event.researchId}` },
    timestamp: new Date().toISOString(),
  };
}

function buildQuestionButtons(
  event: ResearcherQuestionsEvent,
  selectedAnswers: Map<number, string>,
): Array<{ type: number; components: unknown[] }> {
  const rows: Array<{ type: number; components: unknown[] }> = [];

  // For each question with options, create buttons (max 5 per row, max 5 rows)
  for (let qIdx = 0; qIdx < Math.min(event.questions.length, 3); qIdx++) {
    const { options } = parseQuestionOptions(event.questions[qIdx]);
    if (options.length === 0) continue;

    const buttons = options.slice(0, 5).map((opt, oIdx) => {
      const isSelected = selectedAnswers.get(qIdx) === opt;
      return {
        type: 2, // BUTTON
        style: isSelected ? ButtonStyle.Success : ButtonStyle.Secondary,
        label: opt.length > 25 ? opt.slice(0, 22) + "..." : opt,
        custom_id: buildResearcherQuestionCustomId(event.researchId, qIdx, oIdx),
        disabled: isSelected,
      };
    });

    if (buttons.length > 0) {
      rows.push({
        type: 1, // ACTION_ROW
        components: buttons,
      });
    }
  }

  // Add submit/skip row
  rows.push({
    type: 1, // ACTION_ROW
    components: [
      {
        type: 2, // BUTTON
        style: ButtonStyle.Primary,
        label: "Submit Answers",
        custom_id: buildResearcherSubmitCustomId(event.researchId),
        disabled: selectedAnswers.size === 0,
      },
      {
        type: 2, // BUTTON
        style: ButtonStyle.Secondary,
        label: "Skip (use defaults)",
        custom_id: buildResearcherSkipCustomId(event.researchId),
      },
    ],
  });

  return rows.slice(0, 5); // Discord max 5 rows
}

export type DiscordResearcherQuestionsConfig = {
  enabled?: boolean;
  approvers?: Array<string | number>;
};

export type DiscordResearcherQuestionsHandlerOpts = {
  token: string;
  accountId: string;
  config: DiscordResearcherQuestionsConfig;
  gatewayUrl?: string;
  gatewayToken?: string;
  cfg: OpenClawConfig;
};

type PendingQuestions = {
  researchId: string;
  discordMessageId: string;
  discordChannelId: string;
  questions: string[];
  options: string[][];
  selectedAnswers: Map<number, string>;
  timeoutId: ReturnType<typeof setTimeout>;
};

export class DiscordResearcherQuestionsHandler {
  private gatewayClient: GatewayClient | null = null;
  private pending = new Map<string, PendingQuestions>();
  private eventCache = new Map<string, ResearcherQuestionsEvent>();
  private opts: DiscordResearcherQuestionsHandlerOpts;
  private started = false;

  constructor(opts: DiscordResearcherQuestionsHandlerOpts) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;

    const config = this.opts.config;
    if (!config.enabled) {
      logDebug("discord researcher questions: disabled");
      return;
    }

    logDebug("discord researcher questions: starting handler");

    this.gatewayClient = new GatewayClient({
      url: this.opts.gatewayUrl ?? "ws://127.0.0.1:18789",
      token: this.opts.gatewayToken,
      deviceIdentity: null, // Skip device auth, use token auth only
      clientName: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
      clientDisplayName: "Discord Researcher Questions",
      mode: GATEWAY_CLIENT_MODES.BACKEND,
      scopes: ["operator.researcher"],
      onEvent: (evt) => this.handleGatewayEvent(evt),
      onHelloOk: () => {
        logDebug("discord researcher questions: connected to gateway");
      },
      onConnectError: (err) => {
        logError(`discord researcher questions: connect error: ${err.message}`);
      },
      onClose: (code, reason) => {
        logDebug(`discord researcher questions: gateway closed: ${code} ${reason}`);
      },
    });

    this.gatewayClient.start();
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }
    this.started = false;

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeoutId);
    }
    this.pending.clear();
    this.eventCache.clear();

    this.gatewayClient?.stop();
    this.gatewayClient = null;

    logDebug("discord researcher questions: stopped");
  }

  private handleGatewayEvent(evt: EventFrame): void {
    if (evt.event === "researcher.interview.questions") {
      const event = evt.payload as ResearcherQuestionsEvent;
      void this.handleQuestionsEvent(event);
    } else if (evt.event === "researcher.interview.answered") {
      const event = evt.payload as ResearcherAnswerEvent;
      void this.handleAnsweredEvent(event);
    }
  }

  private async handleQuestionsEvent(event: ResearcherQuestionsEvent): Promise<void> {
    // Only handle if notify channel is Discord
    if (event.notify.channel !== "discord") {
      return;
    }

    logDebug(`discord researcher questions: received questions for ${event.researchId}`);

    this.eventCache.set(event.researchId, event);

    // Parse options for each question
    const options = event.questions.map((q) => parseQuestionOptions(q).options);
    event.options = options;

    const { rest, request: discordRequest } = createDiscordClient(
      { token: this.opts.token, accountId: this.opts.accountId },
      this.opts.cfg,
    );

    const selectedAnswers = new Map<number, string>();
    const embed = formatQuestionsEmbed(event, selectedAnswers);
    const components = buildQuestionButtons(event, selectedAnswers);

    try {
      // Send DM to the user
      const userId = event.notify.to;

      // Create DM channel
      const dmChannel = (await discordRequest(
        () =>
          rest.post(Routes.userChannels(), {
            body: { recipient_id: userId },
          }) as Promise<{ id: string }>,
        "dm-channel",
      )) as { id: string };

      if (!dmChannel?.id) {
        logError(`discord researcher questions: failed to create DM for user ${userId}`);
        return;
      }

      // Send message with embed and buttons
      const message = (await discordRequest(
        () =>
          rest.post(Routes.channelMessages(dmChannel.id), {
            body: {
              embeds: [embed],
              components,
            },
          }) as Promise<{ id: string; channel_id: string }>,
        "send-questions",
      )) as { id: string; channel_id: string };

      if (!message?.id) {
        logError(`discord researcher questions: failed to send message to user ${userId}`);
        return;
      }

      // Set up timeout
      const timeoutId = setTimeout(() => {
        void this.handleTimeout(event.researchId);
      }, event.timeoutMs);

      this.pending.set(event.researchId, {
        researchId: event.researchId,
        discordMessageId: message.id,
        discordChannelId: dmChannel.id,
        questions: event.questions,
        options,
        selectedAnswers,
        timeoutId,
      });

      logDebug(
        `discord researcher questions: sent questions ${event.researchId} to user ${userId}`,
      );
    } catch (err) {
      logError(`discord researcher questions: failed to send questions: ${String(err)}`);
    }
  }

  private async handleAnsweredEvent(event: ResearcherAnswerEvent): Promise<void> {
    const pending = this.pending.get(event.researchId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeoutId);
    this.pending.delete(event.researchId);

    const cached = this.eventCache.get(event.researchId);
    this.eventCache.delete(event.researchId);

    if (!cached) {
      return;
    }

    logDebug(`discord researcher questions: answered ${event.researchId}`);

    await this.updateMessage(
      pending.discordChannelId,
      pending.discordMessageId,
      formatCompletedEmbed(cached, event.answers, event.answeredBy),
    );
  }

  private async handleTimeout(researchId: string): Promise<void> {
    const pending = this.pending.get(researchId);
    if (!pending) {
      return;
    }

    this.pending.delete(researchId);

    const cached = this.eventCache.get(researchId);
    this.eventCache.delete(researchId);

    if (!cached) {
      return;
    }

    logDebug(`discord researcher questions: timeout for ${researchId}`);

    await this.updateMessage(
      pending.discordChannelId,
      pending.discordMessageId,
      formatExpiredEmbed(cached),
    );
  }

  private async updateMessage(
    channelId: string,
    messageId: string,
    embed: ReturnType<typeof formatExpiredEmbed>,
  ): Promise<void> {
    try {
      const { rest, request: discordRequest } = createDiscordClient(
        { token: this.opts.token, accountId: this.opts.accountId },
        this.opts.cfg,
      );

      await discordRequest(
        () =>
          rest.patch(Routes.channelMessage(channelId, messageId), {
            body: {
              embeds: [embed],
              components: [], // Remove buttons
            },
          }),
        "update-questions",
      );
    } catch (err) {
      logError(`discord researcher questions: failed to update message: ${String(err)}`);
    }
  }

  async handleButtonClick(
    researchId: string,
    questionIndex: number | undefined,
    optionIndex: number | undefined,
    submit: boolean | undefined,
    skip: boolean | undefined,
    interactionUser?: string,
  ): Promise<{
    success: boolean;
    message: string;
    updatedEmbed?: unknown;
    updatedComponents?: unknown[];
  }> {
    const pending = this.pending.get(researchId);
    if (!pending) {
      return { success: false, message: "This interview is no longer active." };
    }

    const cached = this.eventCache.get(researchId);
    if (!cached) {
      return { success: false, message: "Interview data not found." };
    }

    // Handle skip
    if (skip) {
      clearTimeout(pending.timeoutId);
      this.pending.delete(researchId);
      this.eventCache.delete(researchId);

      // Submit empty/skip via gateway
      await this.submitAnswers(researchId, ["(skipped by user)"], interactionUser);

      return {
        success: true,
        message: "Interview skipped.",
        updatedEmbed: formatSkippedEmbed(cached),
        updatedComponents: [],
      };
    }

    // Handle option selection
    if (questionIndex !== undefined && optionIndex !== undefined) {
      const options = pending.options[questionIndex];
      if (options && options[optionIndex]) {
        pending.selectedAnswers.set(questionIndex, options[optionIndex]);
      }

      // Return updated embed and components
      return {
        success: true,
        message: "Selection recorded.",
        updatedEmbed: formatQuestionsEmbed(cached, pending.selectedAnswers),
        updatedComponents: buildQuestionButtons(cached, pending.selectedAnswers),
      };
    }

    // Handle submit
    if (submit) {
      if (pending.selectedAnswers.size === 0) {
        return { success: false, message: "Please select at least one answer before submitting." };
      }

      clearTimeout(pending.timeoutId);
      this.pending.delete(researchId);
      this.eventCache.delete(researchId);

      // Build answers array
      const answers: string[] = [];
      for (let i = 0; i < pending.questions.length; i++) {
        answers.push(pending.selectedAnswers.get(i) ?? "(no answer)");
      }

      // Submit via gateway
      await this.submitAnswers(researchId, answers, interactionUser);

      return {
        success: true,
        message: "Answers submitted!",
        updatedEmbed: formatCompletedEmbed(cached, answers, interactionUser),
        updatedComponents: [],
      };
    }

    return { success: false, message: "Unknown action." };
  }

  private async submitAnswers(
    researchId: string,
    answers: string[],
    answeredBy?: string,
  ): Promise<void> {
    if (!this.gatewayClient) {
      logError("discord researcher questions: gateway client not connected");
      return;
    }

    try {
      await this.gatewayClient.request("researcher.interview.answer", {
        researchId,
        answers,
        answeredBy,
      });
      logDebug(`discord researcher questions: submitted answers for ${researchId}`);
    } catch (err) {
      logError(`discord researcher questions: submit failed: ${String(err)}`);
    }
  }
}

export type ResearcherQuestionButtonContext = {
  handler: DiscordResearcherQuestionsHandler;
};

export function createResearcherQuestionButtonSpec(
  ctx: ResearcherQuestionButtonContext,
): import("openclaw/extension-bridge").DiscordButtonSpec {
  return {
    customId: `${RESEARCHER_KEY}:seed=1`,
    label: "researchq",
    defer: false,
    ephemeral: false,
    run: async (interaction: ButtonInteraction, data: Record<string, unknown>) => {
      const parsed = parseResearcherQuestionData(data as ComponentData);
      if (!parsed) {
        try {
          await interaction.reply({
            content: "This interview is no longer valid.",
            ephemeral: true,
          });
        } catch {
          // Interaction may have expired
        }
        return;
      }

      const result = await ctx.handler.handleButtonClick(
        parsed.researchId,
        parsed.questionIndex,
        parsed.optionIndex,
        parsed.submit,
        parsed.skip,
        interaction.user?.username,
      );

      if (!result.success) {
        try {
          await interaction.reply({
            content: result.message,
            ephemeral: true,
          });
        } catch {
          // Interaction may have expired
        }
        return;
      }

      // Update the message with new embed/components
      try {
        if (result.updatedEmbed) {
          await interaction.update({
            embeds: [result.updatedEmbed],
            components: result.updatedComponents as never[],
          });
        } else {
          await interaction.deferUpdate();
        }
      } catch {
        // Interaction may have expired
      }
    },
  };
}
