FROM node:lts

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install dependencies
RUN npm install

CMD ["tail", "-f", "/dev/null"]
