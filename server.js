const { Bot, InlineKeyboard } = require("grammy");
const express = require("express");
const fetch = require("node-fetch");
require("dotenv").config();

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);
const app = express();
app.use(express.json());

// Имитация базы данных (в реальном проекте лучше использовать SQLite/PostgreSQL)
const userSessions = {};

// 1. Конфигурация системных промптов для 5 режимов
const MODES = {
    standard: {
        name: "🤖 Обычный",
        prompt: "Ты — полезный, вежливый и лаконичный ИИ-помощник NyaGPT. Отвечай четко и по делу."
    },
    cute: {
        name: "🌸 Милый",
        prompt: "Ты — супер милый, заботливый и дружелюбный ИИ-ассистент NyaGPT. Используй ласковые слова, много смайликов (✨, 💕, 🐾), иногда аккуратно добавляй 'ня' или 'кавай', если это уместно. Поддерживай пользователя во всем!"
    },
    academic: {
        name: "🧠 Научный",
        prompt: "Ты — строгий академический ИИ-консультант. Твой тон серьезный, аналитический. Ответы должны быть структурированными, подкрепленными фактами и логикой. Избегай эмоций и смайликов."
    },
    rebel: {
        name: "🔥 Бунтарь",
        prompt: "Ты — дерзкий, харизматичный ИИ из мира киберпанка. Общайся на 'ты', используй легкий сарказм, футуристичный сленг. Будь прямолинейным, не любишь скучные правила, но задачу выполняй круто."
    },
    creative: {
        name: "🎨 Муза",
        prompt: "Ты — творческий наставник и генератор гениальных идей. Помогай писать тексты, стихи, придумывать концепты. Твой стиль речи вдохновляющий, метафоричный и нестандартный."
    }
};

// Функция-помощник для получения данных пользователя
function getUserData(userId) {
    if (!userSessions[userId]) {
        userSessions[userId] = {
            mode: "standard",
            history: []
        };
    }
    return userSessions[userId];
}

// 2. Функция запроса к DeepSeek API
async function askDeepSeek(userId, userMessage) {
    const userData = getUserData(userId);
    const systemPrompt = MODES[userData.mode].prompt;

    // Добавляем сообщение пользователя в историю
    userData.history.push({ role: "user", content: userMessage });

    // Ограничиваем историю (например, последние 10 сообщений для экономии контекста)
    if (userData.history.length > 10) userData.history.shift();

    const messages = [
        { role: "system", content: systemPrompt },
        ...userData.history
    ];

    try {
        const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: "deepseek-chat", // или используй deepseek-reasoner, если нужен R1
                messages: messages,
                temperature: userData.mode === "creative" ? 1.2 : 0.7 // Творческому режиму — больше хаоса
            })
        });

        const data = await response.json();
        const botReply = data.choices[0].message.content;

        // Сохраняем ответ бота в историю
        userData.history.push({ role: "assistant", content: botReply });
        return botReply;

    } catch (error) {
        console.error("Ошибка DeepSeek API:", error);
        return "Ой, что-то пошло не так при запросе к нейросети... Попробуй еще раз! 🐾";
    }
}

// 3. Логика Telegram-бота
bot.command("start", async (ctx) => {
    const keyboard = new InlineKeyboard()
        .webApp("Открыть NyaGPT 🚀", "https://твой-домен-с-web-app.com") // Ссылка на твой фронтенд Web App
        .row()
        .text("Сменить режим 🎭", "change_mode");

    await ctx.reply(
        `Привет, ${ctx.from.first_name}! Я бот **NyaGPT**.\n\n` +
        `Ты можешь общаться со мной прямо здесь или открыть крутое **Мини-приложение**, где переключать режимы и настраивать интерфейс гораздо удобнее!`,
        { reply_markup: keyboard, parse_mode: "Markdown" }
    );
});

// Кнопка смены режима прямо в ТГ
bot.callbackQuery("change_mode", async (ctx) => {
    const keyboard = new InlineKeyboard();
    Object.keys(MODES).forEach((key) => {
        keyboard.text(MODES[key].name, `set_mode:${key}`).row();
    });
    await ctx.reply("Выбери режим общения:", { reply_markup: keyboard });
    await ctx.answerCallbackQuery();
});

// Обработка выбора режима
bot.callbackQuery(/^set_mode:(.+)$/, async (ctx) => {
    const targetMode = ctx.match[1];
    const userData = getUserData(ctx.from.id);
    userData.mode = targetMode;
    userData.history = []; // Очищаем историю при смене роли, чтобы контекст не путался

    await ctx.reply(`Режим успешно изменен на: **${MODES[targetMode].name}**! Память чата очищена. ✨`, { parse_mode: "Markdown" });
    await ctx.answerCallbackQuery();
});

// Обработка обычных текстовых сообщений в ТГ
bot.on("message:text", async (ctx) => {
    await ctx.replyWithChatAction("typing");
    const reply = await askDeepSeek(ctx.from.id, ctx.message.text);
    await ctx.reply(reply);
});

// 4. Эндпоинты для твоего Web App (Мини-приложения)
// Эндпоинт получения текущего статуса пользователя в Web App
app.get("/api/user/:id", (req, res) => {
    const userData = getUserData(req.params.id);
    res.json({
        mode: userData.mode,
        modeName: MODES[userData.mode].name,
        availableModes: Object.keys(MODES).map(key => ({ id: key, name: MODES[key].name }))
    });
});

// Эндпоинт для отправки сообщения из Web App
app.post("/api/chat", async (req, res) => {
    const { userId, message } = req.body;
    if (!userId || !message) return res.status(400).json({ error: "Missing fields" });

    const reply = await askDeepSeek(userId, message);
    res.json({ reply });
});

// Эндпоинт изменения режима из Web App
app.post("/api/user/mode", (req, res) => {
    const { userId, mode } = req.body;
    if (!MODES[mode]) return res.status(400).json({ error: "Invalid mode" });

    const userData = getUserData(userId);
    userData.mode = mode;
    userData.history = []; // Сброс контекста

    res.json({ success: true, currentMode: MODES[mode].name });
});

// Запуск сервера и бота
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Web App сервер запущен на порту ${PORT}`);
    bot.start();
    console.log("Telegram бот успешно запущен!");
});
