export type TelegramMessage = {
  botToken: string;
  chatId: string;
  text: string;
};

export async function sendTelegramMessage(
  message: TelegramMessage
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${encodeURIComponent(message.botToken)}/sendMessage`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          chat_id: message.chatId,
          text: message.text,
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      }
    );
    if (!response.ok)
      throw new Error(
        `Telegram delivery failed with status ${response.status}`
      );
  } finally {
    clearTimeout(timeout);
  }
}
