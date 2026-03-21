export const handler = async (event, context) => {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }),
  };
};