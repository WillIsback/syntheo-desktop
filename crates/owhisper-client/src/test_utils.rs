use crate::RealtimeSttAdapter;

pub struct UrlTestCase {
    pub name: &'static str,
    pub model: Option<&'static str>,
    pub languages: &'static [anlg_language::ISO639],
    pub contains: &'static [&'static str],
    pub not_contains: &'static [&'static str],
}

pub fn run_url_test_cases<A: RealtimeSttAdapter>(
    adapter: &A,
    api_base: &str,
    cases: &[UrlTestCase],
) {
    for case in cases {
        let params = owhisper_interface::ListenParams {
            model: case.model.map(str::to_string),
            languages: case.languages.iter().map(|l| (*l).into()).collect(),
            ..Default::default()
        };

        let url = adapter.build_ws_url(api_base, &params, 1);
        let url_str = url.as_str();

        for expected in case.contains {
            assert!(
                url_str.contains(expected),
                "[{}] URL should contain '{}' but got: {}",
                case.name,
                expected,
                url_str
            );
        }
        for unexpected in case.not_contains {
            assert!(
                !url_str.contains(unexpected),
                "[{}] URL should NOT contain '{}' but got: {}",
                case.name,
                unexpected,
                url_str
            );
        }
    }
}
