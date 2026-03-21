import { authenticate, checkUsageLimit, enhancePromptWithAI, supabase } from './shared.js';

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    // Authenticate
    const authHeader = event.headers.authorization || event.headers.Authorization;
    const user = await authenticate(authHeader);

    // Check usage limit
    const { usageCount, plan } = await checkUsageLimit(user);

    // Parse body
    const { prompt, settings, userApiKey } = JSON.parse(event.body);

    // Enhance
    const result = await enhancePromptWithAI(prompt, settings, userApiKey, plan);

    // Log usage
    await supabase.from('usage_logs').insert({
      user_id: user.id,
      action: 'enhance',
      prompt_length: prompt.length,
      plan,
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(result),
    };
  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};