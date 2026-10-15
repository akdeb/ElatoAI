import os
import unittest
from unittest.mock import patch

from models.llm import atlascloud
from models.providers import get_provider_registry, get_provider_spec, validate_provider_env


class AtlasCloudProviderTest(unittest.TestCase):
    def test_registry_supports_canonical_name_and_alias(self):
        registry = get_provider_registry("llm")

        self.assertEqual(registry["atlascloud"], "models.llm.atlascloud")
        self.assertEqual(registry["atlas_cloud"], "models.llm.atlascloud")
        self.assertEqual(get_provider_spec("llm", "Atlas_Cloud").name, "atlascloud")

    def test_environment_validation_requires_atlascloud_key(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "ATLASCLOUD_API_KEY"):
                validate_provider_env("llm", "atlascloud")

        with patch.dict(os.environ, {"ATLASCLOUD_API_KEY": "test-key"}, clear=True):
            validate_provider_env("llm", "atlascloud")

    def test_factory_uses_openai_compatible_defaults(self):
        with (
            patch.dict(os.environ, {"ATLASCLOUD_API_KEY": "test-key"}, clear=True),
            patch.object(atlascloud, "OpenAILLMService") as service,
        ):
            service.Settings.return_value = "settings"
            atlascloud.create_service(system_instruction="Be concise")

        service.Settings.assert_called_once_with(
            model="deepseek-ai/deepseek-v4-pro",
            system_instruction="Be concise",
        )
        service.assert_called_once_with(
            api_key="test-key",
            base_url="https://api.atlascloud.ai/v1",
            settings="settings",
        )


if __name__ == "__main__":
    unittest.main()
