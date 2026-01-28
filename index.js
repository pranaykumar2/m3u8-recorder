const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const https = require('https');

try {
    const ffmpegPath = require('ffmpeg-static');
    ffmpeg.setFfmpegPath(ffmpegPath);
} catch (e) {
    console.log("ffmpeg-static not found, assuming global ffmpeg");
}
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

// Helper to probe format from HLS playlist if not specified
function probeFormat(url) {
    return new Promise((resolve) => {
        const request = https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk.toString();
                // Check for Codecs in Master Playlist
                if (data.includes('mp4a.40.34')) {
                    request.destroy();
                    resolve('mp3');
                } else if (data.includes('mp4a.40.5') || data.includes('mp4a.40.2')) {
                    request.destroy();
                    resolve('adts');
                } else if (data.length > 8192) {
                    // Give up after 8KB
                    request.destroy();
                    resolve(null);
                }
            });
            res.on('end', () => resolve(null));
            res.on('error', () => resolve(null));
        });
        request.on('error', () => resolve(null));
    });
}

app.get('/', (req, res) => {
    res.send('Akashvani Recorder Service Running');
});

// Endpoint to Stream-Rip and Pipe back to client immediately
app.get('/record', async (req, res) => {
    const streamUrl = req.query.url;
    const filename = req.query.filename || 'recording.mp3';
    let format = req.query.format; // 'mp3' or 'aac'

    if (!streamUrl) {
        return res.status(400).send('Missing url parameter');
    }

    console.log(`Starting recording for: ${streamUrl}`);

    // If format not specified, try to probe
    if (!format) {
        console.log("No format specified, probing stream...");
        const probed = await probeFormat(streamUrl);
        if (probed) {
            console.log(`Probe detected: ${probed}`);
            format = probed;
        } else {
            console.log("Probe failed or inconclusive, defaulting to adts (AAC)");
            format = 'adts';
        }
    } else {
        // Map common names to ffmpeg formats
        if (format === 'aac') format = 'adts';
    }

    console.log(`Using format: ${format}`);

    // Determine content type
    let contentType = 'audio/mpeg'; // Default MP3
    if (format === 'adts') contentType = 'audio/aac';

    res.header('Content-Disposition', `attachment; filename="${filename}"`);
    res.header('Content-Type', contentType);

    // Create FFmpeg command
    const command = ffmpeg(streamUrl)
        .format(format)
        .audioCodec('copy')
        .on('error', (err) => {
            if (err.message.includes('SIGKILL')) {
                console.log('Recording stopped by user (SIGKILL).');
            } else {
                console.error('An error occurred: ' + err.message);
                if (!res.headersSent) {
                    // If headers not sent, we can send error
                    try {
                        res.status(500).send('Recording error');
                    } catch (e) { }
                }
            }
        })
        .on('end', () => {
            console.log('Processing finished !');
        });

    // Pipe the ffmpeg output directly to the response
    command.pipe(res, { end: true });

    // Handle client disconnect
    req.on('close', () => {
        console.log('Client disconnected, killing ffmpeg...');
        command.kill('SIGKILL');
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
