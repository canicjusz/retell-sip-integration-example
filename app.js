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
const RECIPIENT_TYPES = {
  event_manager: "Event Manager",
  recepcja: "Recepcja"
}
const RECIPIENT_IDS = {
  event_manager: MANAGER_ID,
  recepcja: RECEPTION_ID
}
const SPECIFIC_RECIPIENT_IDS = {
  recepcja: RECEPTION_ID
}

function extracted(recipientId, messageBody) {
  return {
    recipient: {id: recipientId},
    messaging_type: "MESSAGE_TAG", // lub 'RESPONSE' w zależności od okna 24h
    tag: "ACCOUNT_UPDATE",
    message: {text: messageBody},
    access_token: FB_ACCESS_TOKEN,
  };
}

app.post("/webhook-retell", async (req, res) => {
  const { event, call } = req.body;

  // Szybka odpowiedź dla Retell (acknowledge), aby nie ponawiał requestu
  res.status(204).send();

  if (event === "call_analyzed" && call.from_number) {
    try {
      // 1. Ekstrakcja danych
      const fromNumber = call.from_number;
      const summary = call.call_analysis?.call_summary || "Brak podsumowania";
      const receiverType = call.call_analysis?.custom_analysis_data?.receiver_type;

      // 3. Wysyłka wiadomości, jeśli znaleziono odbiorcę
      if (SPECIFIC_RECIPIENT_IDS[receiverType]) {
        const messageBody = `Numer telefonu: ${fromNumber}, Docelowy odbiorca: ${RECIPIENT_TYPES[receiverType]} \nWiadomość: ${summary}`;
        const facebookApiUrl = `https://graph.facebook.com/${FB_API_VERSION}/${FB_PAGE_ID}/messages`;

        await axios.post(facebookApiUrl, extracted(RECIPIENT_IDS[receiverType], messageBody));

        if(!receiverType !== "event_manager") {
          await axios.post(facebookApiUrl, extracted(RECIPIENT_IDS["event_manager"], messageBody));
        }

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
