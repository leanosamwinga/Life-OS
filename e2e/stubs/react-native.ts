// Node stand-in for react-native in the e2e test: the app code only reads Platform.
export const Platform = {
  OS: 'ios' as 'ios' | 'android' | 'web',
  select<T>(o: { ios?: T; default?: T }) {
    return o.ios ?? o.default;
  },
};
