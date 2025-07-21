# Use the official Deno image
FROM denoland/deno:alpine-1.42.1

# The port Render will expose
EXPOSE 3000

# Set working directory
WORKDIR /app

# Copy backend code
COPY . .

# Copy contract/plutus.json for validator access
COPY ../contract/plutus.json ./contract/plutus.json

# Cache dependencies
RUN deno cache mainmod.ts

# Run the backend
CMD ["run", "--allow-net", "--allow-env", "--allow-read", "mainmod.ts"]