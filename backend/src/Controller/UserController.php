<?php

namespace App\Controller;

use App\Entity\User;
use App\Repository\UserRepository;
use App\Service\RegistrationService;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Annotation\Route;
use Symfony\Component\Validator\Validator\ValidatorInterface;
use Symfony\Bundle\SecurityBundle\Security;
use Symfony\Component\Serializer\SerializerInterface;

#[Route('/api')]
class UserController extends AbstractController
{
    private $security;
    private $serializer;
    private $userRepository;
    
    public function __construct(
        Security $security,
        SerializerInterface $serializer,
        UserRepository $userRepository
    ) {
        $this->security = $security;
        $this->serializer = $serializer;
        $this->userRepository = $userRepository;
    }
    
    #[Route('/register', name: 'app_register', methods: ['POST'])]
    public function register(
        Request $request,
        RegistrationService $registrationService,
        ValidatorInterface $validator,
        EntityManagerInterface $entityManager
    ): JsonResponse {
        try {
            // Récupérer les données
            $data = json_decode($request->getContent(), true);

            // Valider les données basiques
            if (!isset($data['email']) || !isset($data['password'])) {
                return $this->json([
                    'success' => false,
                    'message' => 'Données incomplètes. Email et mot de passe requis.'
                ], 400);
            }

            // Vérifier si l'email est déjà utilisé
            $existingUser = $entityManager->getRepository(User::class)->findOneBy(['email' => $data['email']]);
            if ($existingUser) {
                return $this->json([
                    'success' => false,
                    'message' => 'Cet email est déjà utilisé.'
                ], 400);
            }

            // Enregistrer l'utilisateur via le service
            $user = $registrationService->registerUser($data);

            return $this->json([
                'success' => true,
                'message' => 'Inscription réussie !',
                'user' => [
                    'id' => $user->getId(),
                    'firstName' => $user->getFirstName(),
                    'lastName' => $user->getLastName(),
                    'email' => $user->getEmail()
                ]
            ], 201);
        } catch (\InvalidArgumentException $e) {
            // Erreurs de validation
            return $this->json([
                'success' => false,
                'message' => 'Erreurs de validation',
                'errors' => json_decode($e->getMessage(), true)
            ], 400);
        } catch (\Exception $e) {
            // Log l'erreur pour débogage
            error_log($e->getMessage());

            return $this->json([
                'success' => false,
                'message' => 'Une erreur est survenue: ' . $e->getMessage()
            ], 500);
        }
    }

    #[Route('/test', name: 'app_test', methods: ['GET'])]
    public function test(): JsonResponse
    {
        return $this->json([
            'success' => true,
            'message' => 'API Symfony fonctionnelle !'
        ]);
    }
}