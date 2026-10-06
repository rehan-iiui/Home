export default async function handler(req, res) {
    // Only allow POST requests
    if (req.method !== "POST") {
        return res.status(405).json({
            error: "METHOD_NOT_ALLOWED",
            message: "Only POST requests are allowed."
        });
}

    try {
        // Check API key
        const apiKey = process.env.OPENAI_API_KEY;

        if (!apiKey) {
            return res.status(500).json({
                error: "MISSING_API_KEY",
                message: "OPENAI_API_KEY is not configured in Vercel."
            });
        }

        // Read request body safely
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


        // Validate message
        if (!message) {
            return res.status(400).json({
                error: "EMPTY_MESSAGE",
                message: "Please provide a message."
            });
        }


        if (!feature) {
            return res.status(400).json({
                error: "INVALID_FEATURE",
                message: "Please select a valid tutor feature."
            });
        }


        // =========================
        // SYSTEM INSTRUCTIONS
        // =========================

        let instructions = "";


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
`;
        }


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
`;
        }


        // =========================
        // MODEL
        // =========================

        const model =
            process.env.OPENAI_MODEL ||
            "gpt-6-luna";


        // =========================
        // OPENAI RESPONSES API
        // =========================

        const openaiResponse =
            await fetch(
                "https://api.openai.com/v1/responses",
                {
                    method: "POST",

                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${apiKey}`
                    },

                    body: JSON.stringify({
                        model: model,

                        instructions: instructions,

                        input: message,

                        max_output_tokens: 2500
                    })
                }
            );


        // =========================
        // READ OPENAI RESPONSE
        // =========================

        const contentType =
            openaiResponse.headers.get("content-type") || "";

        let data = null;
        let rawText = "";


        if (contentType.includes("application/json")) {

            data = await openaiResponse.json();

        } else {

            rawText = await openaiResponse.text();

            return res.status(502).json({
                error: "INVALID_UPSTREAM_RESPONSE",
                message: "The AI provider returned a non-JSON response."
            });
        }


        // =========================
        // HANDLE API ERRORS
        // =========================

        if (!openaiResponse.ok) {

            const providerError =
                data?.error?.message ||
                data?.error ||
                "The AI provider rejected the request.";

            const status =
                openaiResponse.status || 500;


            if (status === 401) {

                return res.status(401).json({
                    error: "UNAUTHORIZED",
                    message:
                        "The API key is invalid or unauthorized."
                });
            }


            if (status === 403) {

                return res.status(403).json({
                    error: "FORBIDDEN",
                    message:
                        "The API request was forbidden."
                });
            }


            if (status === 429) {

                return res.status(429).json({
                    error: "RATE_LIMIT",
                    message:
                        "The AI API rate limit or usage limit was reached."
                });
            }


            return res.status(502).json({
                error: "OPENAI_API_ERROR",
                message: providerError
            });
        }


        // =========================
        // EXTRACT OUTPUT TEXT
        // =========================

        let answer =
            typeof data?.output_text === "string"
                ? data.output_text.trim()
                : "";


        /*
         * Fallback parser in case output_text
         * is not present in the response.
         */

        if (!answer && Array.isArray(data?.output)) {

            const parts = [];

            for (const item of data.output) {

                if (!Array.isArray(item?.content)) {
                    continue;
                }

                for (const content of item.content) {

                    if (
                        content?.type === "output_text" &&
                        typeof content.text === "string"
                    ) {
                        parts.push(content.text);
                    }
                }
            }

            answer =
                parts.join("\n").trim();
        }


        // =========================
        // EMPTY RESPONSE
        // =========================

        if (!answer) {

            return res.status(502).json({
                error: "EMPTY_AI_RESPONSE",
                message:
                    "The AI returned an empty response."
            });
        }


        // =========================
        // SUCCESS
        // =========================

        return res.status(200).json({
            success: true,
            feature: feature,
            answer: answer
        });


    } catch (error) {

        console.error("Vercel API error:", error);


        return res.status(500).json({
            error: "SERVER_ERROR",
            message:
                "The tutor server could not complete the request."
        });
    }
}
