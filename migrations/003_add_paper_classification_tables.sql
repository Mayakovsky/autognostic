-- Migration: 003_add_paper_classification_tables.sql
-- Purpose: Add tables for scientific paper classification (5-level taxonomy)
-- Implements the lakehouse pattern: Bronze → Silver → Gold zones

-- Paper classification records
CREATE TABLE IF NOT EXISTS autognostic.paper_classification (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL,
  
  -- Lakehouse zone tracking
  zone TEXT NOT NULL DEFAULT 'bronze' CHECK (zone IN ('bronze', 'silver', 'gold')),
  promoted_to_silver_at TIMESTAMPTZ,
  promoted_to_gold_at TIMESTAMPTZ,
  
  -- Primary classification path (L1 → L4)
  primary_path JSONB,
  
  -- Secondary classification paths (for interdisciplinary papers)
  secondary_paths JSONB DEFAULT '[]'::jsonb,
  
  -- Level 5: Research Focus (structured facets)
  focus JSONB,
  
  -- Classification metadata
  confidence REAL,
  evidence JSONB DEFAULT '[]'::jsonb,
  classifier_version TEXT,
  
  -- Paper metadata extracted from Crossref/content
  paper_metadata JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Taxonomy nodes for L1-L4 hierarchy
CREATE TABLE IF NOT EXISTS autognostic.taxonomy_nodes (
  id TEXT PRIMARY KEY,
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 4),
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES autognostic.taxonomy_nodes(id),
  aliases JSONB DEFAULT '[]'::jsonb,
  definition TEXT,
  keywords JSONB DEFAULT '[]'::jsonb,
  examples JSONB DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated')),
  version_introduced TEXT DEFAULT '1.0',
  version_deprecated TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Controlled vocabulary for Level 5 facets
CREATE TABLE IF NOT EXISTS autognostic.controlled_vocab (
  id TEXT PRIMARY KEY,
  facet_type TEXT NOT NULL,
  term TEXT NOT NULL,
  aliases JSONB DEFAULT '[]'::jsonb,
  definition TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated')),
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_paper_class_document ON autognostic.paper_classification(document_id);
CREATE INDEX IF NOT EXISTS idx_paper_class_zone ON autognostic.paper_classification(zone);
CREATE INDEX IF NOT EXISTS idx_taxonomy_level ON autognostic.taxonomy_nodes(level);
CREATE INDEX IF NOT EXISTS idx_vocab_facet ON autognostic.controlled_vocab(facet_type);

-- Insert starter L1 taxonomy nodes
INSERT INTO autognostic.taxonomy_nodes (id, level, name, definition, keywords) VALUES
  ('L1.NATSCI', 1, 'Natural Sciences', 'Physical sciences including physics, chemistry, earth science', '["physics", "chemistry", "astronomy", "earth science", "materials", "geology"]'),
  ('L1.LIFESCI', 1, 'Life Sciences', 'Biological sciences including biology, ecology, genetics', '["biology", "ecology", "evolution", "microbiology", "neuroscience", "biochemistry", "genetics"]'),
  ('L1.MEDHLT', 1, 'Medical & Health Sciences', 'Clinical medicine and health-related research', '["medicine", "clinical", "health", "medical", "pharmaceutical", "epidemiology"]'),
  ('L1.ENGTECH', 1, 'Engineering & Technology', 'Applied sciences and technology', '["engineering", "computer science", "electrical", "mechanical", "software", "robotics"]'),
  ('L1.SOCSCI', 1, 'Social Sciences', 'Study of society and human behavior', '["economics", "psychology", "sociology", "political", "anthropology", "education"]'),
  ('L1.HUMARTS', 1, 'Humanities & Arts', 'Humanistic disciplines and arts research', '["history", "philosophy", "linguistics", "literature", "cultural", "art"]'),
  ('L1.INTERDIS', 1, 'Interdisciplinary & Applied', 'Cross-domain and applied research', '["environmental", "cognitive science", "data science", "sustainability", "policy"]'),
  ('L1.FORMAL', 1, 'Formal & Computational Foundations', 'Mathematical and computational foundations', '["mathematics", "statistics", "probability", "optimization", "information theory"]')
ON CONFLICT (id) DO NOTHING;

-- Insert starter controlled vocabulary: task_study_type
INSERT INTO autognostic.controlled_vocab (id, facet_type, term, definition) VALUES
  ('task.theory', 'task_study_type', 'theory', 'Theoretical/mathematical development'),
  ('task.exp_vivo', 'task_study_type', 'experiment_in_vivo', 'Experiments in living organisms'),
  ('task.exp_vitro', 'task_study_type', 'experiment_in_vitro', 'Experiments in controlled lab environment'),
  ('task.exp_situ', 'task_study_type', 'experiment_in_situ', 'Experiments in natural setting'),
  ('task.observation', 'task_study_type', 'observation', 'Observational study'),
  ('task.simulation', 'task_study_type', 'simulation', 'Computational simulation'),
  ('task.method_dev', 'task_study_type', 'method_development', 'Development of new methods'),
  ('task.dataset', 'task_study_type', 'dataset_creation', 'Creation of datasets'),
  ('task.benchmark', 'task_study_type', 'benchmarking', 'Benchmarking/comparison study'),
  ('task.sys_review', 'task_study_type', 'systematic_review', 'Systematic literature review'),
  ('task.meta', 'task_study_type', 'meta_analysis', 'Meta-analysis'),
  ('task.rct', 'task_study_type', 'clinical_trial_randomized', 'Randomized controlled trial'),
  ('task.ct_nonrand', 'task_study_type', 'clinical_trial_nonrandomized', 'Non-randomized clinical trial'),
  ('task.case_study', 'task_study_type', 'case_study', 'Case study'),
  ('task.field', 'task_study_type', 'field_study', 'Field study'),
  ('task.survey', 'task_study_type', 'survey', 'Survey research'),
  ('task.qual', 'task_study_type', 'qualitative_interviews', 'Qualitative interviews'),
  ('task.replication', 'task_study_type', 'replication', 'Replication study')
ON CONFLICT (id) DO NOTHING;

-- Insert starter controlled vocabulary: method_approach
INSERT INTO autognostic.controlled_vocab (id, facet_type, term, definition) VALUES
  ('method.stat_inf', 'method_approach', 'statistical_inference', 'Statistical inference methods'),
  ('method.bayes', 'method_approach', 'bayesian_modeling', 'Bayesian probabilistic modeling'),
  ('method.ml_sup', 'method_approach', 'machine_learning_supervised', 'Supervised machine learning'),
  ('method.ml_unsup', 'method_approach', 'machine_learning_unsupervised', 'Unsupervised machine learning'),
  ('method.dl', 'method_approach', 'deep_learning', 'Deep learning / neural networks'),
  ('method.optim', 'method_approach', 'optimization', 'Optimization methods'),
  ('method.control', 'method_approach', 'control_systems', 'Control systems theory'),
  ('method.micro', 'method_approach', 'microscopy', 'Microscopy techniques'),
  ('method.spectro', 'method_approach', 'spectroscopy', 'Spectroscopy'),
  ('method.chrom', 'method_approach', 'chromatography', 'Chromatography'),
  ('method.ms', 'method_approach', 'mass_spectrometry', 'Mass spectrometry'),
  ('method.cryo', 'method_approach', 'cryo_em', 'Cryo-electron microscopy'),
  ('method.xray', 'method_approach', 'xray_diffraction', 'X-ray diffraction'),
  ('method.nmr', 'method_approach', 'nmr', 'Nuclear magnetic resonance'),
  ('method.dft', 'method_approach', 'computational_dft', 'Density functional theory'),
  ('method.md', 'method_approach', 'molecular_dynamics', 'Molecular dynamics simulation'),
  ('method.fem', 'method_approach', 'finite_element_analysis', 'Finite element analysis'),
  ('method.survey_inst', 'method_approach', 'survey_instrument', 'Survey instruments'),
  ('method.econom', 'method_approach', 'econometric_modeling', 'Econometric modeling'),
  ('method.ethno', 'method_approach', 'ethnography', 'Ethnographic methods'),
  ('method.corpus', 'method_approach', 'corpus_linguistics', 'Corpus linguistics')
ON CONFLICT (id) DO NOTHING;

-- Add comment
COMMENT ON TABLE autognostic.paper_classification IS 'Scientific paper classification records implementing 5-level taxonomy with Bronze/Silver/Gold lakehouse zones';
COMMENT ON TABLE autognostic.taxonomy_nodes IS 'Hierarchical taxonomy nodes (L1-L4) for scientific paper classification';
COMMENT ON TABLE autognostic.controlled_vocab IS 'Controlled vocabulary for Level 5 research focus facets';
