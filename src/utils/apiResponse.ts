export const successResponse = <TData, TMeta extends Record<string, unknown>>(
  data: TData,
  meta: TMeta = {} as TMeta,
) => {
  return {
    success: true,
    data,
    meta,
  };
};
