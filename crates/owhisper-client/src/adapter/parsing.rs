use owhisper_interface::stream::Word;

pub fn ms_to_secs(ms: u64) -> f64 {
    ms as f64 / 1000.0
}

pub struct WordBuilder {
    word: String,
    start: f64,
    end: f64,
    confidence: f64,
    speaker: Option<i32>,
    punctuated_word: Option<String>,
}

impl WordBuilder {
    pub fn new(word: impl Into<String>) -> Self {
        let word = word.into();
        Self {
            punctuated_word: Some(word.clone()),
            word,
            start: 0.0,
            end: 0.0,
            confidence: 1.0,
            speaker: None,
        }
    }

    pub fn start(mut self, start: f64) -> Self {
        self.start = start;
        self
    }

    pub fn end(mut self, end: f64) -> Self {
        self.end = end;
        self
    }

    pub fn confidence(mut self, confidence: f64) -> Self {
        self.confidence = confidence;
        self
    }

    pub fn speaker(mut self, speaker: Option<i32>) -> Self {
        self.speaker = speaker;
        self
    }

    pub fn build(self) -> Word {
        Word {
            word: self.word,
            start: self.start,
            end: self.end,
            confidence: self.confidence,
            speaker: self.speaker,
            punctuated_word: self.punctuated_word,
            language: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ms_to_secs() {
        assert_eq!(ms_to_secs(0), 0.0);
        assert_eq!(ms_to_secs(1000), 1.0);
        assert_eq!(ms_to_secs(1500), 1.5);
    }

    #[test]
    fn test_word_builder() {
        let word = WordBuilder::new("test")
            .start(1.5)
            .end(2.5)
            .confidence(0.95)
            .speaker(Some(1))
            .build();

        assert_eq!(word.word, "test");
        assert_eq!(word.start, 1.5);
        assert_eq!(word.end, 2.5);
        assert_eq!(word.confidence, 0.95);
        assert_eq!(word.speaker, Some(1));
        assert_eq!(word.punctuated_word, Some("test".to_string()));
        assert_eq!(word.language, None);
    }
}
