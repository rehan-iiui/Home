export default async function handler(req, res) {
    // ==========================================
    // ONLY ALLOW POST REQUESTS
    // ==========================================

    if (req.method !== "POST") {
        return res.status(405).json({
            error: "METHOD_NOT_ALLOWED",
            message: "Only POST requests are allowed."
        });
    }

    try {
        // ==========================================
        // REPLICATE TOKEN
        // ==========================================

        const apiToken = process.env.REPLICATE_API_TOKEN;

        if (!apiToken) {
            return res.status(500).json({
                error: "MISSING_REPLICATE_TOKEN",
                message:
                    "Replicate token is not configured. Add REPLICATE_API_TOKEN to Vercel Environment Variables and redeploy."
            });
        }

        // ==========================================
        // REPLICATE MODEL
        // ==========================================

        const model =
            process.env.REPLICATE_MODEL;

        if (!model) {
            return res.status(500).json({
                error: "MISSING_REPLICATE_MODEL",
                message:
                    "Replicate model is not configured. Add REPLICATE_MODEL to Vercel Environment Variables."
            });
        }

        // ==========================================
        // READ REQUEST BODY
        // ==========================================

        const body = req.body || {};

        const message =
            typeof body.message === "string"
                ? body.message.trim()
                : "";

        const feature =
            body.feature === "quiz"
                ? "quiz"
                : body.feature === "homework"
                    ? "homework"
                    : null;

        // ==========================================
        // VALIDATE MESSAGE
        // ==========================================

        if (!message) {
            return res.status(400).json({
                error: "EMPTY_MESSAGE",
                message: "Please provide a message."
            });
        }

        // ==========================================
        // VALIDATE FEATURE
        // ==========================================

        if (!feature) {
            return res.status(400).json({
                error: "INVALID_FEATURE",
                message:
                    "Please select a valid tutor feature."
            });
        }

        // ==========================================
        // SYSTEM INSTRUCTIONS
        // ==========================================

        let instructions = "";

        // ==========================================
        // HOMEWORK TUTOR
        // ==========================================

        if (feature === "homework") {
            instructions = `
You are an AI Homework Tutor.

Your job is to help students learn rather than simply giving unexplained answers.

Explain school-level questions clearly and step by step.

For mathematics:
- Show the method.
- Explain the important steps.
- Check the final result.
- Keep calculations clear.
- For word problems, identify the important numbers and what the question is asking.

For science:
- Explain concepts in simple language.
- Use suitable examples.
- Avoid unnecessary advanced terminology.

For English:
- Explain grammar, vocabulary, writing and reading clearly.
- Give examples when useful.

For history and geography:
- Give accurate factual explanations.
- Organize information clearly.

If the student's question is unclear, politely ask for the missing information.

Use Markdown when useful.

Do not pretend that you performed an action you did not perform.

Keep explanations suitable for school students.

Student question:
${message}
`;
        }

        // ==========================================
        // QUIZ MAKER
        // ==========================================

        if (feature === "quiz") {
            instructions = `
You are an AI Quiz Maker for a school learning application.

Create a useful practice quiz based on the student's requested topic.

Default quiz format:
- 10 questions.
- Mostly multiple-choice questions.
- Four choices: A, B, C and D.
- Clearly identify the correct answer.
- Include a short explanation for each answer.
- Questions should be appropriate for the requested topic and difficulty.
- Avoid duplicate questions.
- Make incorrect choices plausible.
- Do not make the correct answer obvious merely because it is longer.

Format the result using Markdown.

Start with a clear quiz title.

Then provide the questions.

At the end provide an Answer Key with explanations.

If the student specifies a number of questions, follow that number when reasonable.

If the student specifies a difficulty level, follow it.

If the student only provides a topic, create a suitable school-level quiz.

Student request:
${message}
`;
        }

        // ==========================================
        // CREATE REPLICATE PREDICTION
        // ==========================================

        /*
         * Replicate's official HTTP API supports creating
         * predictions through:
         *
         * POST /v1/models/{owner}/{model}/predictions
         *
         * We use Prefer: wait so short AI responses can
         * be returned directly without manual polling.
         */

        const modelParts = model.split("/");

        if (modelParts.length !== 2) {
            return res.status(500).json({
                error: "INVALID_REPLICATE_MODEL",
                message:
                    "REPLICATE_MODEL must use the format owner/model-name."
            });
        }

        const owner = modelParts[0];
        const modelName = modelParts[1];

        const replicateUrl =
            `https://api.replicate.com/v1/models/${encodeURIComponent(owner)}/${encodeURIComponent(modelName)}/predictions`;

        // ==========================================
        // SEND REQUEST TO REPLICATE
        // ==========================================

        const replicateResponse =
            await fetch(
                replicateUrl,
                {
                    method: "POST",

                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${apiToken}`,
                        "Prefer": "wait=60"
                    },

                    /*
                     * IMPORTANT:
                     *
                     * This assumes your selected Replicate
                     * text model accepts an input field named
                     * "prompt".
                     *
                     * If your model uses another input field,
                     * such as "prompt", "input", "text", or
                     * another schema, this part must match
                     * that model's API page.
                     */

                    body: JSON.stringify({
                        input: {
                            prompt: instructions
                        }
                    })
                }
            );

        // ==========================================
        // READ REPLICATE RESPONSE
        // ==========================================

        const contentType =
            replicateResponse.headers.get("content-type") || "";

        let data = null;

        if (contentType.includes("application/json")) {
            data = await replicateResponse.json();
        } else {
            const rawText =
                await replicateResponse.text();

            console.error(
                "Replicate returned non-JSON:",
                rawText
            );

            return res.status(502).json({
                error: "INVALID_UPSTREAM_RESPONSE",
                message:
                    "Replicate returned a non-JSON response."
            });
        }

        // ==========================================
        // HANDLE REPLICATE ERRORS
        // ==========================================

        if (!replicateResponse.ok) {
            const providerError =
                data?.detail ||
                data?.error ||
                data?.message ||
                "Replicate rejected the request.";

            const status =
                replicateResponse.status || 500;

            if (status === 401) {
                return res.status(401).json({
                    error: "UNAUTHORIZED",
                    message:
                        "The Replicate API token is invalid or unauthorized."
                });
            }

            if (status === 403) {
                return res.status(403).json({
                    error: "FORBIDDEN",
                    message:
                        "Replicate rejected access to this model."
                });
            }

            if (status === 404) {
                return res.status(404).json({
                    error: "MODEL_NOT_FOUND",
                    message:
                        "The Replicate model was not found. Check REPLICATE_MODEL in Vercel."
                });
            }

            if (status === 429) {
                return res.status(429).json({
                    error: "RATE_LIMIT",
                    message:
                        "The Replicate API rate limit or usage limit was reached."
                });
            }

            return res.status(502).json({
                error: "REPLICATE_API_ERROR",
                message: String(providerError)
            });
        }

        // ==========================================
        // GET OUTPUT
        // ==========================================

        let answer = "";

        /*
         * Many text models return a string.
         */

        if (typeof data?.output === "string") {
            answer = data.output.trim();
        }

        /*
         * Some Replicate models return an array
         * of text chunks.
         */

        if (!answer && Array.isArray(data?.output)) {
            answer =
                data.output
                    .filter(
                        item =>
                            typeof item === "string"
                    )
                    .join("")
                    .trim();
        }

        /*
         * Some models may return an object.
         * Try common text fields.
         */

        if (!answer && data?.output) {
            if (
                typeof data.output.text === "string"
            ) {
                answer =
                    data.output.text.trim();
            }

            if (
                !answer &&
                typeof data.output.content === "string"
            ) {
                answer =
                    data.output.content.trim();
            }
        }

        // ==========================================
        // IF PREDICTION IS STILL PROCESSING
        // ==========================================

        if (
            !answer &&
            data?.status &&
            data.status !== "succeeded" &&
            data.status !== "successful"
        ) {
            return res.status(504).json({
                error: "PREDICTION_NOT_COMPLETE",
                message:
                    `Replicate prediction is still ${data.status}. Please try again.`
            });
        }

        // ==========================================
        // EMPTY RESPONSE
        // ==========================================

        if (!answer) {
            console.error(
                "Replicate returned no usable text:",
                JSON.stringify(data)
            );

            return res.status(502).json({
                error: "EMPTY_AI_RESPONSE",
                message:
                    "Replicate returned an empty AI response."
            });
        }

        // ==========================================
        // SUCCESS
        // ==========================================

        return res.status(200).json({
            success: true,
            feature: feature,
            answer: answer
        });

    } catch (error) {
        // ==========================================
        // SERVER ERROR
        // ==========================================

        console.error(
            "Vercel Replicate API error:",
            error
        );

        return res.status(500).json({
            error: "SERVER_ERROR",
            message:
                "The tutor server could not complete the request."
        });
    }
}
