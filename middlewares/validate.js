function createValidator(schema, source = "body") {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const issues = result.error?.issues || result.error?.errors || [];
      const firstError = issues[0];
      const message =
        firstError?.message ||
        result.error?.issues?.[0]?.message ||
        "Validation failed";
      return res.status(400).json({
        success: false,
        error: message,
      });
    }
    req[source] = result.data;
    next();
  };
}

module.exports = {
  validateBody: (schema) => createValidator(schema, "body"),
  validateQuery: (schema) => createValidator(schema, "query"),
  validateParams: (schema) => createValidator(schema, "params"),
};