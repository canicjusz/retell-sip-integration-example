const express = require('express');
const axios = require('axios')
const app = express();
const {createServer} = require('http');
const {createEndpoint} = require('@jambonz/node-client-ws');
const server = createServer(app);
const makeService = createEndpoint({server});
const webhooks = require('./lib/webhooks');
const logger = require('pino')({level: process.env.LOGLEVEL || 'info'});
const port = process.env.WS_PORT || process.env.PORT || 3000;

app.locals = {
  ...app.locals,
  logger
};

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/', webhooks);

require('./lib/routes')({logger, makeService});

const {
  PORT = 8080,
  FB_API_VERSION,
  FB_PAGE_ID,
  FB_ACCESS_TOKEN,
  MANAGER_ID,
  RECEPTION_ID
} = process.env;

app.post("/webhook-retell", async (req, res) => {
  const { event, call } = req.body;

  // Szybka odpowiedź dla Retell (acknowledge), aby nie ponawiał requestu
  res.status(204).send();

  if (event === "call_analyzed") {
    try {
      // 1. Ekstrakcja danych
      const fromNumber = call.from_number;
      const summary = call.call_analysis?.call_summary || "Brak podsumowania";
      const receiverType = call.call_analysis?.custom_analysis_data?.receiver_type;

      // 2. Wybór odbiorcy na podstawie receiver_type
      let recipientId = null;
      if (receiverType === "event_manager") {
        recipientId = MANAGER_ID;
      } else if (receiverType === "recepcja") {
        recipientId = RECEPTION_ID;
      }

      // 3. Wysyłka wiadomości, jeśli znaleziono odbiorcę
      if (recipientId) {
        const messageBody = `Numer telefonu: ${fromNumber},\nWiadomość: ${summary}`;
        const facebookApiUrl = `https://graph.facebook.com/${FB_API_VERSION}/${FB_PAGE_ID}/messages`;

        await axios.post(facebookApiUrl, {
          recipient: { id: recipientId },
          messaging_type: "MESSAGE_TAG", // lub 'RESPONSE' w zależności od okna 24h
          tag: "ACCOUNT_UPDATE",
          message: { text: messageBody },
          access_token: FB_ACCESS_TOKEN,
        });

        console.log(`[SUCCESS] Wysłano wiadomość do: ${receiverType}`);
      } else {
        console.log(`[INFO] Pominięto wysyłkę. Receiver type: ${receiverType}`);
      }

    } catch (error) {
      console.error("[ERROR] Błąd wysyłki FB:", error.response?.data || error.message);
    }
  } else {
    console.log(`Otrzymano inny event: ${event}`);
  }
});


server.listen(port, () => {
  logger.info(`jambonz websocket server listening at http://localhost:${port}`);
});
