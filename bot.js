const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const http = require('http');
const mammoth = require('mammoth');

// Your Telegram Bot Token
const BOT_TOKEN = '8624502955:AAEFg7RM8Nrz_--TU1q9gBtmAbX_v-4CuQc';
const bot = new Telegraf(BOT_TOKEN, {
    handlerTimeout: 120000
});

// List of languages
const languages = {
    'af': 'Afrikaans', 'sq': 'Albanian', 'am': 'Amharic', 'ar': 'Arabic', 
    'bn': 'Bengali', 'zh-CN': 'Chinese (Simp)', 'zh-TW': 'Chinese (Trad)', 
    'hr': 'Croatian', 'cs': 'Czech', 'da': 'Danish', 'nl': 'Dutch', 
    'en': 'English', 'eo': 'Esperanto', 'fi': 'Finnish', 'fr': 'French', 
    'de': 'German', 'el': 'Greek', 'hi': 'Hindi', 'hu': 'Hungarian', 
    'id': 'Indonesian', 'it': 'Italian', 'ja': 'Japanese', 'ko': 'Korean', 
    'om': 'Oromo', 'fa': 'Persian', 'pl': 'Polish', 'pt': 'Portuguese', 
    'ro': 'Romanian', 'ru': 'Russian', 'es': 'Spanish', 'sw': 'Swahili', 
    'sv': 'Swedish', 'th': 'Thai', 'tr': 'Turkish', 'uk': 'Ukrainian', 
    'vi': 'Vietnamese'
};

const messageSessions = {};

// Barreeffama bifa salphaan amansiisaa ta'een addaan kutuuf (Fixes 400 Error)
function splitTextIntoSafeChunks(text, chunkSize = 1000) {
    const chunks = [];
    let i = 0;
    while (i < text.length) {
        chunks.push(text.substring(i, i + chunkSize));
        i += chunkSize;
    }
    return chunks;
}

// Translation Function
async function translateText(text, toLang) {
    try {
        // Mallattoolee bitaa ta'an qulqulleessuuf
        const cleanedText = text.replace(/[\r\n]+/g, ' ').trim();
        const chunks = splitTextIntoSafeChunks(cleanedText, 1000);
        let finalTranslatedText = "";

        for (const chunk of chunks) {
            if (!chunk.trim()) continue;

            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${toLang}&dt=t&q=${encodeURIComponent(chunk)}`;
            const response = await axios.get(url, { timeout: 10000 });
            
            if (response.data && response.data[0]) {
                response.data[0].forEach(sentence => {
                    if (sentence[0]) {
                        finalTranslatedText += sentence[0] + " ";
                    }
                });
            }
            // Google akka nu hin block-ineef seconds muraasa eeguu
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        return finalTranslatedText.trim() || "No translation found.";
    } catch (error) {
        console.error("Translation Error Details:", error.response ? error.response.status : error.message);
        return "Translation failed due to formatting or size. Please try with smaller text.";
    }
}

function getLanguageButtons() {
    const buttons = [];
    const langKeys = Object.keys(languages);
    for (let i = 0; i < langKeys.length; i += 3) {
        const row = [];
        if (langKeys[i]) row.push(Markup.button.callback(languages[langKeys[i]], `lang_${langKeys[i]}`));
        if (langKeys[i+1]) row.push(Markup.button.callback(languages[langKeys[i+1]], `lang_${langKeys[i+1]}`));
        if (langKeys[i+2]) row.push(Markup.button.callback(languages[langKeys[i+2]], `lang_${langKeys[i+2]}`));
        buttons.push(row);
    }
    return Markup.inlineKeyboard(buttons);
}

bot.start(async (ctx) => {
    try {
        await ctx.reply("Welcome! Send me any text or upload a '.txt' or '.docx' (Word) file, and I will show you buttons to choose the target language.");
    } catch (e) {
        console.error("Start command error:", e.message);
    }
});

bot.on('text', async (ctx) => {
    try {
        const chatId = ctx.chat.id;
        const userText = ctx.message.text;
        const sentMessage = await ctx.reply("Please select the language you want to translate the text to:", getLanguageButtons());
        const sessionKey = `${chatId}_${sentMessage.message_id}`;
        messageSessions[sessionKey] = userText;
    } catch (e) {
        console.error("Text handling error:", e.message);
    }
});

bot.on('document', async (ctx) => {
    try {
        const chatId = ctx.chat.id;
        const doc = ctx.message.document;
        const fileName = doc.file_name.toLowerCase();

        await ctx.reply("Reading your file... ⏳");
        const fileLink = await ctx.telegram.getFileLink(doc.file_id);

        let fileContent = "";

        if (doc.mime_type === 'text/plain' || fileName.endsWith('.txt')) {
            const fileResponse = await axios.get(fileLink.href);
            fileContent = fileResponse.data.toString();
        } 
        else if (fileName.endsWith('.docx')) {
            const fileResponse = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(fileResponse.data);
            const result = await mammoth.extractRawText({ buffer: buffer });
            fileContent = result.value;
        } 
        else {
            return ctx.reply("Please upload valid '.txt' or '.docx' (Word) files only.");
        }

        if (!fileContent.trim()) {
            return ctx.reply("Your file appears to be empty!");
        }

        const sentMessage = await ctx.reply(`File "${doc.file_name}" received successfully!\n\nPlease select the language you want to translate to:`, getLanguageButtons());
        const sessionKey = `${chatId}_${sentMessage.message_id}`;
        messageSessions[sessionKey] = fileContent;

    } catch (e) {
        console.error("Document handling error:", e.message);
        ctx.reply("An error occurred while reading the file. Make sure it's a valid text or docx file.");
    }
});

bot.action(/^lang_(.+)$/, async (ctx) => {
    try {
        const targetLang = ctx.match[1];
        const targetLangName = languages[targetLang];
        const chatId = ctx.chat.id;
        const messageId = ctx.callbackQuery.message.message_id;
        const sessionKey = `${chatId}_${messageId}`;
        const savedContent = messageSessions[sessionKey];

        if (!savedContent) {
            return ctx.reply("Session expired or text not found. Please send a new text or file.");
        }

        await ctx.answerCbQuery(`Translating to ${targetLangName}...`);
        await ctx.editMessageText(`Translating content to ${targetLangName}... ⏳`);

        const translatedResult = await translateText(savedContent, targetLang);
        
        // Telegram irratti ergaa dheeraa kutaatti qoodanii erguuf
        const responseChunks = splitTextIntoSafeChunks(translatedResult, 3500);
        for (const chunk of responseChunks) {
            await ctx.reply(`📝 **Translation (${targetLangName}):**\n\n${chunk}`);
        }
        
        delete messageSessions[sessionKey];
    } catch (e) {
        console.error("Button action error:", e.message);
    }
});

bot.catch((err, ctx) => {
    console.error(`Bot encountered an error for ${ctx.updateType}:`, err.message);
});

// Launch Bot
bot.launch({
    allowedUpdates: ['message', 'callback_query'],
    dropPendingUpdates: true
})
.then(() => {
    console.log("=========================================");
    console.log("🚀 Bot is running smoothly with Safe Chunking!");
    console.log("=========================================");
})
.catch((error) => {
    console.error("❌ Failed to start the bot:", error.message);
});

// DUMMY SERVER FOR RENDER PORT BINDING
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is alive!\n');
}).listen(PORT, () => {
    console.log(`Dummy server is listening on port ${PORT}`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));