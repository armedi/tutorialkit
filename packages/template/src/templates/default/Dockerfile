FROM node:20-alpine

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application
COPY . .

# Expose the default port
EXPOSE 3000

# Default command - can be overridden by docker-compose
CMD ["npm", "start"]
