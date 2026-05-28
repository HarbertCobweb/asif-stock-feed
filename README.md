
# Auburn Stock Feed

## Install

npm install

## Local Run

cp .env.example .env

Add your OpenAI key to .env

npm start

## Routes

/                -> Frontend
/api/refresh     -> Refresh stock cache
/data/stocks.json -> Raw cached JSON
