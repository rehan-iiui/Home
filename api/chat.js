export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const token = process.env.REPLICATE_API_TOKEN;

    if (!token) {
      return res.status(500).json({
        success: false,
        error: "REPLICATE_API_TOKEN is not configured in Vercel."
      });
    }

    const body = req.body || {};
    const message =
      typeof body.message === "string"
        ? body.message.trim()
        : "";

    const feature =
      typeof body.feature === "string"
        ? body.feature
        : "homework";

    if (!message) {
      return res.status(400).json({
        success: false,
        error: "Please enter a message."
      });
    }

    let systemPrompt = `
You are AI Tutor Studio, a friendly AI homework tutor.

Help students understand their work clearly and step by step.

Use simple language appropriate for a school student.
Do not simply give an answer when an explanation would help.
Show the working for mathematics and explain important steps.
For quizzes, create useful practice questions and provide answers when appropriate.

Be encouraging, clear, accurate, and concise.
`;

    if (feature === "quiz") {
      systemPrompt += `
The user selected Quiz Maker.
Create a useful quiz based on the user's request.
Include questions with clear formatting.
If the user gives a subject or topic, focus the quiz on that topic.
`;
    } else {
      systemPrompt += `
The user selected AI Homework Tutor.
Solve or explain the homework problem step by step.
`;
    }

    const prompt = `
${systemPrompt}

Student's request:
${message}
`;

    const replicateResponse = await fetch(
      "https://api.replicate.com/v1/models/openai/gpt-4.1-nano/predictions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
          "Prefer": "wait"
        },
        body: JSON.stringify({
          input: {
            top_p: 1,
            prompt,
            messages: [],
            image_input: [],
            temperature: 1,
            system_prompt: systemPrompt,
            presence_penalty: 0,
            frequency_penalty: 0,
            max_completion_tokens: 2000
          }
        })
      }
    );

    const responseText = await replicateResponse.text();

    let prediction;

    try {
      prediction = JSON.parse(responseText);
    } catch {
      return res.status(502).json({
        success: false,
        error: "Replicate returned an invalid response."
      });
    }

    if (!replicateResponse.ok) {
      console.error("Replicate API error:", prediction);

      return res.status(replicateResponse.status).json({
        success: false,
        error:
          prediction?.detail ||
          prediction?.error ||
          "Replicate API request failed."
      });
    }

    /*
      Prefer: wait normally makes Replicate wait for the prediction.
      However, if the prediction is still processing, poll it below.
    */

    let finalPrediction = prediction;

    if (
      prediction?.status &&
      !["succeeded", "failed", "canceled"].includes(prediction.status)
    ) {
      const predictionUrl =
        prediction?.urls?.get ||
        `https://api.replicate.com/v1/predictions/${prediction.id}`;

      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        const pollResponse = await fetch(predictionUrl, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
          }
        });

        const pollText = await pollResponse.text();

        let pollData;

        try {
          pollData = JSON.parse(pollText);
        } catch {
          continue;
        }

        if (!pollResponse.ok) {
          return res.status(pollResponse.status).json({
            success: false,
            error:
              pollData?.detail ||
              pollData?.error ||
              "Unable to check the AI response."
          });
        }

        finalPrediction = pollData;

        if (
          finalPrediction.status === "succeeded" ||
          finalPrediction.status === "failed" ||
          finalPrediction.status === "canceled"
        ) {
          break;
        }
      }
    }

    if (finalPrediction.status === "failed") {
      console.error("Prediction failed:", finalPrediction);

      return res.status(502).json({
        success: false,
        error:
          finalPrediction.error ||
          "The AI model failed to generate a response."
      });
    }

    if (finalPrediction.status === "canceled") {
      return res.status(502).json({
        success: false,
        error: "The AI request was canceled."
      });
    }

    /*
      GPT-4.1 Nano can return output in different forms depending
      on the Replicate response. Handle the common possibilities.
    */

    let answer = "";

    const output = finalPrediction.output;

    if (typeof output === "string") {
      answer = output;
    } else if (Array.isArray(output)) {
      answer = output.join("");
    } else if (output && typeof output === "object") {
      answer =
        output.text ||
        output.content ||
        output.output_text ||
        "";
    }

    // Some responses may contain an OpenAI-style output structure.
    if (!answer && Array.isArray(finalPrediction.output)) {
      for (const item of finalPrediction.output) {
        if (typeof item === "string") {
          answer += item;
        } else if (item?.content) {
          if (Array.isArray(item.content)) {
            for (const part of item.content) {
              if (typeof part === "string") {
                answer += part;
              } else if (part?.text) {
                answer += part.text;
              }
            }
          } else if (typeof item.content === "string") {
            answer += item.content;
          }
        } else if (item?.text) {
          answer += item.text;
        }
      }
    }

    answer = String(answer || "").trim();

    if (!answer) {
      console.error(
        "Replicate returned no usable answer:",
        JSON.stringify(finalPrediction)
      );

      return res.status(502).json({
        success: false,
        error: "The AI returned an empty response."
      });
    }

    return res.status(200).json({
      success: true,
      answer
    });

  } catch (error) {
    console.error("Server error:", error);

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Something went wrong while contacting the AI."
    });
  }
}
