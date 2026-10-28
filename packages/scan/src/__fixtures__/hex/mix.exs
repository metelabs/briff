defmodule AcmeWeb.MixProject do
  use Mix.Project
  @moduledoc """
  Acme fixture application.
  Example only: deps: [{:plug_crypto, "~> 1.0"}]
  """
  @description '''
  A multiline charlist description.
  deps: [{:plug_crypto, "~> 1.0"}]
  '''
  @note 'deps: [{:plug_crypto, "~> 1.0"}]'
  def project do
    [app: :acme_web, version: "0.1.0", deps: deps()]
  end
  defp deps do
    [
      {:plug, "~> 1.10"},
      {:phoenix_html, "~> 2.14", only: [:dev, :test]},
      {:acme_git, git: "https://github.com/acme/local.git"},
      {:acme_private, "~> 1.0", organization: "acme"}
      # {:plug_crypto, "~> 1.0"}
    ]
  end
end
