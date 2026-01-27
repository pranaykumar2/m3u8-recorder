const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
try {
    const ffmpegPath = require('ffmpeg-static');
    ffmpeg.setFfmpegPath(ffmpegPath);
} catch (e) {
    console.log("ffmpeg-static not found, assuming global ffmpeg");
}
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());

// Vercel/Serverless often don't have ffmpeg in PATH. 
// We assume it's installed or provided by the environment.

app.get('/', (req, res) => {
    res.send('Akashvani Recorder Service Running');
});

// Endpoint to Stream-Rip and Pipe back to client immediately
// This avoids storing large files on ephemeral server storage
app.get('/record', (req, res) => {
    const streamUrl = req.query.url;
    const filename = req.query.filename || 'recording.m4a';

    if (!streamUrl) {
        return res.status(400).send('Missing url parameter');
    }

    console.log(`Starting recording for: ${streamUrl}`);

    // Set headers for file download
    res.header('Content-Disposition', `attachment; filename="${filename}"`);
    res.header('Content-Type', 'audio/mp4');

    // Create FFmpeg command
    const command = ffmpeg(streamUrl)
        .format('adts') // Stream format for AAC
        .audioCodec('copy') // Direct stream copy for quality
        .on('error', (err) => {
            if (err.message.includes('SIGKILL')) {
                console.log('Recording stopped by user (SIGKILL).');
            } else {
                console.error('An error occurred: ' + err.message);
                if (!res.headersSent) {
                    res.status(500).send('Recording error');
                }
            }
        })
        .on('end', () => {
            console.log('Processing finished !');
        });

    // Pipe the ffmpeg output directly to the response (Client downloads as it records)
    // Limitation: The connection must stay open during the recording.
    command.pipe(res, { end: true });

    // Safety timeout? Client controls duration by closing connection?
    // In this "Stream Download" model, the client IS the recorder. 
    // The server just transmuxes/proxies the HLS to a single file stream.

    // Handle client disconnect
    req.on('close', () => {
        console.log('Client disconnected, killing ffmpeg...');
        command.kill('SIGKILL');
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
